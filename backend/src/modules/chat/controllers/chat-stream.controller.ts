import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Req,
  Res,
  Sse,
  MessageEvent,
} from '@nestjs/common';
import { Response } from 'express';
import { Observable, Subject } from 'rxjs';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser, AuthUser } from '../../auth/decorators/current-user.decorator';
import { TurnRuntimeService, RuntimeEvent } from '../../../core/orchestrator/turn-runtime.service';
import { ChatService } from '../services/chat.service';
import { SendMessageDto } from '../dto/send-message.dto';

/**
 * SSE 双向流端点 — Claude-style 同 turn 暂停 + 续推。
 *
 * Flow:
 *   1. POST /chat/stream/start — creates a turn (background generator), returns turnId
 *   2. GET  /chat/stream/:turnId — SSE stream of all turn events (replays past + tails live)
 *   3. POST /chat/stream/:turnId/answer — resume a paused clarify
 *
 * 断线重连：客户端直接 GET /chat/stream/:turnId 即可 — runtime replay 已发生事件再续推。
 */
@ApiTags('chat-stream')
@Controller('chat/stream')
export class ChatStreamController {
  constructor(
    private readonly runtime: TurnRuntimeService,
    private readonly chatService: ChatService,
  ) {}

  /**
   * 创建一个新 turn — 后台 spawn generator，立即返回 turnId。
   * 客户端用 turnId 连 SSE 流。
   */
  @Post('start')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '创建 SSE turn — 后台 spawn generator 并立刻返回 turnId' })
  async startTurn(
    @CurrentUser() user: AuthUser,
    @Body() dto: SendMessageDto,
  ): Promise<{ turnId: string; conversationId: string; userMessageId: string }> {
    // 用 chatService 预创建 conversation + user message（保证 SSE 流期间消息已存在）
    const prep = await this.chatService.prepareTurnForStream(dto, user.id);

    const { turnId } = this.runtime.createTurn({
      mode: prep.mode,
      question: prep.effectiveQuestion,
      datasourceId: dto.datasourceId,
      conversationId: prep.conversationId,
      userId: user.id,
      overrideAllowedTables: prep.overrideAllowedTables,
      datasetContext: prep.datasetContext,
      currentAttachments: prep.currentAttachments,
    });

    // Wire up the post-turn finalize logic: when generator finishes,
    // persist assistant message + lineage + chart etc.
    this.chatService.finalizeStreamingTurnInBackground(turnId, prep);

    return { turnId, conversationId: prep.conversationId, userMessageId: prep.userMessageId };
  }

  /**
   * SSE 流 — 连上后立刻 replay 该 turn 的所有历史事件，然后 tail live events。
   */
  @Sse(':turnId')
  @ApiOperation({ summary: 'SSE 事件流 — replay + tail；支持断线重连' })
  stream(@Param('turnId') turnId: string): Observable<MessageEvent> {
    const subject = new Subject<MessageEvent>();
    const unsubscribe = this.runtime.subscribe(turnId, (ev: RuntimeEvent) => {
      subject.next({
        type: ev.type,
        id: String(ev._seq ?? ''),
        data: ev,
      } as MessageEvent);
      if (ev.type === 'finalize' || ev.type === 'error') {
        // Give the client a beat to receive then close
        setTimeout(() => subject.complete(), 50);
      }
    });

    // Clean up subscription when client disconnects
    subject.subscribe({
      complete: () => unsubscribe(),
    });

    return subject.asObservable();
  }

  /**
   * 用户答 clarify — 续推 generator。
   * SSE 流会自动推后续事件。
   */
  @Post(':turnId/answer')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '提供 clarify 答案 — 续推 generator' })
  async submitAnswer(
    @Param('turnId') turnId: string,
    @Body() body: { answer: string },
  ): Promise<{ ok: boolean; reason?: string }> {
    return this.runtime.submitClarifyAnswer(turnId, body.answer);
  }
}
