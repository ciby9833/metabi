import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import { Response } from 'express';
import { ApiBearerAuth, ApiTags, ApiOperation, ApiResponse, ApiQuery } from '@nestjs/swagger';
import { ChatService } from '../services/chat.service';
import { MessageFeedbackService } from '../services/feedback.service';
import { ChatExportService } from '../services/export.service';
import { SendMessageDto, CreateConversationDto } from '../dto/send-message.dto';
import { SubmitFeedbackDto } from '../dto/feedback.dto';
import { CurrentUser, AuthUser } from '../../auth/decorators/current-user.decorator';

@ApiBearerAuth()
@ApiTags('Chat')
@Controller('chat')
export class ChatController {
  constructor(
    private readonly chatService: ChatService,
    private readonly feedbackService: MessageFeedbackService,
    private readonly exportService: ChatExportService,
  ) {}

  // 老的 POST /chat 已删 — 唯一通路是 SSE：
  //   POST /chat/stream/start → 拿 turnId
  //   GET  /chat/stream/:turnId → SSE 流
  //   POST /chat/stream/:turnId/answer → 续推 clarify
  // 见 ChatStreamController。

  @Post('conversations')
  @ApiOperation({ summary: '创建对话' })
  async createConversation(@CurrentUser() user: AuthUser, @Body() dto: CreateConversationDto) {
    return this.chatService.createConversation(dto, user.id);
  }

  @Get('conversations')
  @ApiOperation({ summary: '获取当前用户的对话列表（含 project 内对话）' })
  @ApiQuery({ name: 'project_id', required: false })
  async listConversations(@CurrentUser() user: AuthUser, @Query('project_id') projectId?: string) {
    return this.chatService.listConversations(user.id, { projectId });
  }

  @Get('conversations/:id/history')
  @ApiOperation({ summary: '获取对话消息历史' })
  async getHistory(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.chatService.getHistory(id, user.id);
  }

  @Patch('conversations/:id')
  @ApiOperation({ summary: '更新对话（移到项目 / 移出项目 / 改标题）' })
  async updateConversation(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: { projectId?: string | null; title?: string },
  ) {
    return this.chatService.updateConversation(id, user.id, dto);
  }

  @Delete('conversations/:id')
  @HttpCode(204)
  @ApiOperation({ summary: '删除对话' })
  async deleteConversation(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    await this.chatService.deleteConversation(id, user.id);
  }

  // ============== 消息反馈 ==============

  @Post('messages/:id/feedback')
  @ApiOperation({ summary: '提交对 assistant 消息的反馈（good/bad）' })
  submitFeedback(@Param('id') messageId: string, @Body() dto: SubmitFeedbackDto) {
    return this.feedbackService.submit(messageId, dto);
  }

  @Get('messages/:id/feedback')
  @ApiOperation({ summary: '查询某条消息的反馈历史' })
  getFeedback(@Param('id') messageId: string) {
    return this.feedbackService.getByMessage(messageId);
  }

  // ============== 导出（不进 LLM，独立路径） ==============

  /**
   * 「导出全量」：从消息原 SQL 重新执行，按指定格式流式下载。
   *
   * format=csv / excel / markdown
   * strip_limit=true 时会**剥掉** SQL 结尾的 LIMIT N，拿真正的全量
   *                   （但仍受 SQL_EXPORT_MAX_ROWS 上限）
   * include_rows: 仅对 markdown 报告生效，控制嵌入报告内的预览行数（默认 200）
   */
  @Get('messages/:id/export')
  @ApiOperation({ summary: '导出该消息对应 SQL 的全量结果 (CSV / Excel / Markdown 报告)' })
  @ApiQuery({ name: 'format', enum: ['csv', 'excel', 'markdown'] })
  @ApiQuery({ name: 'strip_limit', required: false })
  @ApiQuery({ name: 'include_rows', required: false })
  async exportMessage(
    @Param('id') messageId: string,
    @Query('format') format: string,
    @Query('strip_limit') stripLimit: string | undefined,
    @Query('include_rows') includeRows: string | undefined,
    @Res() res: Response,
  ) {
    const strip = stripLimit === 'true' || stripLimit === '1';
    const rows = includeRows ? parseInt(includeRows, 10) : undefined;
    switch (format) {
      case 'csv':
        return this.exportService.exportCsv(messageId, res, { stripLimit: strip });
      case 'excel':
        return this.exportService.exportExcel(messageId, res, { stripLimit: strip });
      case 'markdown':
        return this.exportService.exportMarkdown(messageId, res, {
          stripLimit: strip,
          includeRows: rows,
        });
      default:
        throw new BadRequestException(`不支持的格式 ${format}，可选 csv / excel / markdown`);
    }
  }
}
