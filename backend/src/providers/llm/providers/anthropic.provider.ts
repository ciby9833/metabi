import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Anthropic from '@anthropic-ai/sdk';
import { BaseLLMProvider } from './base.provider';
import {
  ChatMessage,
  ConversationMessage,
  LLMCallOptions,
  LLMProvider,
  LLMResponse,
  LLMStreamEvent,
  LLMToolResponse,
  ToolDeclaration,
} from '../types';

/**
 * Anthropic Claude Provider — supports official Anthropic SDK with adaptive thinking.
 *
 * Default model: claude-opus-4-8 (Anthropic's most capable widely-released model).
 *
 * Notes:
 *  - Adaptive thinking is enabled by default for non-trivial requests (Claude
 *    decides depth dynamically; no budget_tokens needed).
 *  - Tool schema uses Anthropic's `input_schema` format (not OpenAI's `parameters`).
 *  - System prompts go in the top-level `system` field, not in messages.
 *  - Streaming events use Anthropic's SSE shapes (content_block_start /
 *    content_block_delta / message_delta) — we adapt to our LLMStreamEvent.
 */
@Injectable()
export class AnthropicProvider extends BaseLLMProvider {
  readonly providerName = LLMProvider.ANTHROPIC;
  private readonly logger = new Logger(AnthropicProvider.name);
  private client: Anthropic | null = null;
  private defaultModel: string;

  constructor(private readonly configService: ConfigService) {
    super();
    const apiKey = this.configService.get<string>('app.llm.anthropic.apiKey');
    this.defaultModel =
      this.configService.get<string>('app.llm.anthropic.model') || 'claude-opus-4-8';

    if (!apiKey) {
      this.enabled = false;
      this.logger.warn('Anthropic API key not configured; provider disabled');
      return;
    }
    this.client = new Anthropic({ apiKey });
  }

  /** 普通文本对话（无工具）*/
  async callChat(messages: ChatMessage[], options?: LLMCallOptions): Promise<LLMResponse> {
    if (!this.client) throw new Error('Anthropic provider is not configured');
    const start = Date.now();
    const model = options?.model || this.defaultModel;

    // 分离 system 消息：Anthropic 把 system 放在顶层而非 messages
    const { system, claudeMessages } = this.splitSystemMessages(messages);

    const response = await this.client.messages.create({
      model,
      max_tokens: options?.maxTokens || 16000,
      system: system || undefined,
      messages: claudeMessages as any,
      // 不传 thinking 字段则默认行为；jsonMode 没有原生支持，靠 prompt 指引
    });

    const text = response.content
      .filter((b) => b.type === 'text')
      .map((b: any) => b.text)
      .join('\n');

    return {
      content: text,
      provider: this.providerName,
      model,
      usage: response.usage
        ? {
            promptTokens: response.usage.input_tokens,
            completionTokens: response.usage.output_tokens,
            totalTokens: response.usage.input_tokens + response.usage.output_tokens,
          }
        : undefined,
      latencyMs: Date.now() - start,
      raw: response,
    };
  }

  /** 带工具调用对话（非流式）*/
  async callWithTools(
    messages: ConversationMessage[],
    tools: ToolDeclaration[],
    options?: LLMCallOptions,
  ): Promise<LLMToolResponse> {
    if (!this.client) throw new Error('Anthropic provider is not configured');
    const start = Date.now();
    const model = options?.model || this.defaultModel;

    const { system, anthropicMessages } = this.toAnthropicMessages(messages);

    const response = await this.client.messages.create({
      model,
      max_tokens: options?.maxTokens || 16000,
      system: system || undefined,
      messages: anthropicMessages as any,
      tools: tools.map((t) => ({
        name: t.name,
        description: t.description,
        input_schema: t.parameters as any,
      })),
    });
    const latencyMs = Date.now() - start;

    const usageNorm = response.usage
      ? {
          promptTokens: response.usage.input_tokens,
          completionTokens: response.usage.output_tokens,
          totalTokens: response.usage.input_tokens + response.usage.output_tokens,
        }
      : undefined;

    const toolUseBlocks = response.content.filter((b: any) => b.type === 'tool_use');
    if (toolUseBlocks.length > 0) {
      const textContent = response.content
        .filter((b: any) => b.type === 'text')
        .map((b: any) => b.text)
        .join('\n');
      return {
        type: 'tool_calls',
        toolCalls: toolUseBlocks.map((tc: any) => ({
          id: tc.id,
          name: tc.name,
          arguments: tc.input || {},
        })),
        content: textContent || undefined,
        provider: this.providerName,
        model,
        usage: usageNorm,
        latencyMs,
        raw: response,
      };
    }

    const text = response.content
      .filter((b: any) => b.type === 'text')
      .map((b: any) => b.text)
      .join('\n');
    return {
      type: 'message',
      content: text,
      provider: this.providerName,
      model,
      usage: usageNorm,
      latencyMs,
      raw: response,
    };
  }

  /**
   * 流式带工具调用 — Anthropic SSE 协议适配：
   *   content_block_start (tool_use) → tool_call_start
   *   content_block_delta (input_json_delta) → tool_call_args_delta
   *   content_block_delta (text_delta) → text_delta
   *   content_block_stop → tool_call_end (仅对 tool_use 块)
   *   message_delta (含 stop_reason + usage) → message_end
   */
  async *streamWithTools(
    messages: ConversationMessage[],
    tools: ToolDeclaration[],
    options?: LLMCallOptions,
  ): AsyncGenerator<LLMStreamEvent, void, void> {
    if (!this.client) {
      yield { type: 'error', message: 'Anthropic provider is not configured' };
      return;
    }
    const model = options?.model || this.defaultModel;
    const { system, anthropicMessages } = this.toAnthropicMessages(messages);

    let stream;
    try {
      stream = this.client.messages.stream({
        model,
        max_tokens: options?.maxTokens || 16000,
        system: system || undefined,
        messages: anthropicMessages as any,
        tools: tools.map((t) => ({
          name: t.name,
          description: t.description,
          input_schema: t.parameters as any,
        })),
      });
    } catch (err) {
      yield { type: 'error', message: (err as Error).message };
      return;
    }

    // 跟踪每个 content block index → { type, toolId, toolName }
    const indexToBlock = new Map<number, { type: string; id?: string; name?: string }>();
    let finishReason: string = 'unknown';
    let usage: { promptTokens: number; completionTokens: number; totalTokens: number } | undefined;
    let promptTokens = 0;

    try {
      for await (const event of stream) {
        switch (event.type) {
          case 'message_start': {
            const u = (event as any).message?.usage;
            if (u?.input_tokens) promptTokens = u.input_tokens;
            break;
          }
          case 'content_block_start': {
            const idx = (event as any).index;
            const block = (event as any).content_block;
            indexToBlock.set(idx, { type: block.type, id: block.id, name: block.name });
            if (block.type === 'tool_use') {
              yield {
                type: 'tool_call_start',
                id: block.id,
                name: block.name,
              };
            }
            break;
          }
          case 'content_block_delta': {
            const idx = (event as any).index;
            const delta = (event as any).delta;
            const blockInfo = indexToBlock.get(idx);
            if (!blockInfo) continue;

            if (delta.type === 'text_delta') {
              yield { type: 'text_delta', text: delta.text };
            } else if (delta.type === 'input_json_delta' && blockInfo.id) {
              yield {
                type: 'tool_call_args_delta',
                id: blockInfo.id,
                argsDelta: delta.partial_json || '',
              };
            }
            break;
          }
          case 'content_block_stop': {
            const idx = (event as any).index;
            const blockInfo = indexToBlock.get(idx);
            if (blockInfo?.type === 'tool_use' && blockInfo.id) {
              yield { type: 'tool_call_end', id: blockInfo.id };
            }
            break;
          }
          case 'message_delta': {
            const delta = (event as any).delta;
            if (delta?.stop_reason) {
              finishReason = this.normalizeFinishReason(delta.stop_reason);
            }
            const u = (event as any).usage;
            if (u?.output_tokens != null) {
              usage = {
                promptTokens,
                completionTokens: u.output_tokens,
                totalTokens: promptTokens + u.output_tokens,
              };
            }
            break;
          }
          // message_stop / ping 忽略
        }
      }
    } catch (err) {
      yield { type: 'error', message: `stream interrupted: ${(err as Error).message}` };
      return;
    }

    yield {
      type: 'message_end',
      finishReason: finishReason as any,
      usage,
    };
  }

  // ============ 工具方法 ============

  /** 普通 callChat 用：把 system role 消息抽出，剩余转给 messages */
  private splitSystemMessages(messages: ChatMessage[]): {
    system: string | null;
    claudeMessages: { role: 'user' | 'assistant'; content: any }[];
  } {
    const systems = messages.filter((m) => m.role === 'system').map((m) => m.content);
    const rest = messages
      .filter((m) => m.role !== 'system')
      .map((m) => {
        // 无附件 → 纯文本；有附件 → 走 content block 数组（image / text 混合）
        if (!m.attachments || m.attachments.length === 0) {
          return { role: m.role as 'user' | 'assistant', content: m.content };
        }
        const blocks: any[] = [];
        for (const att of m.attachments) {
          if (att.kind === 'image' && att.imageBase64 && att.imageMime) {
            blocks.push({
              type: 'image',
              source: {
                type: 'base64',
                media_type: att.imageMime,
                data: att.imageBase64,
              },
            });
          } else if (att.textBlock) {
            // table / pdf / text 已经 pre-format 好，直接作为 text block 塞进去
            blocks.push({
              type: 'text',
              text: `<attachment name="${att.filename}" kind="${att.kind}">\n${att.textBlock}\n</attachment>`,
            });
          }
        }
        // 最后放用户原始文本 —— Anthropic 建议 image 放前面 text 放后面
        blocks.push({ type: 'text', text: m.content });
        return { role: m.role as 'user' | 'assistant', content: blocks };
      });
    return {
      system: systems.length > 0 ? systems.join('\n\n') : null,
      claudeMessages: rest,
    };
  }

  /**
   * Convert our ConversationMessage[] 到 Anthropic 消息格式：
   *  - system messages → 顶层 system 字段
   *  - tool result messages → user role 内 tool_result content block
   *  - assistant tool calls → assistant role 内 tool_use content block
   *  - 普通 user/assistant text → 直接
   */
  private toAnthropicMessages(messages: ConversationMessage[]): {
    system: string | null;
    anthropicMessages: any[];
  } {
    const systems: string[] = [];
    const anthropicMessages: any[] = [];

    // 临时合并 tool result：Anthropic 要求 tool_result 必须放在 user role 里
    let pendingToolResults: any[] = [];

    const flushToolResults = () => {
      if (pendingToolResults.length > 0) {
        anthropicMessages.push({ role: 'user', content: pendingToolResults });
        pendingToolResults = [];
      }
    };

    for (const m of messages) {
      if (m.role === 'system') {
        systems.push(m.content);
        continue;
      }
      if (m.role === 'tool') {
        // tool result 必须在 user role 里
        pendingToolResults.push({
          type: 'tool_result',
          tool_use_id: m.toolCallId,
          content: m.content,
        });
        continue;
      }
      // 非 tool 消息前先 flush tool results
      flushToolResults();

      if (m.role === 'assistant' && 'toolCalls' in m && m.toolCalls?.length) {
        const content: any[] = [];
        if (m.content) content.push({ type: 'text', text: m.content });
        for (const tc of m.toolCalls) {
          content.push({
            type: 'tool_use',
            id: tc.id,
            name: tc.name,
            input: tc.arguments,
          });
        }
        anthropicMessages.push({ role: 'assistant', content });
      } else {
        const msg = m as ChatMessage;
        // 有附件（image / textBlock）→ 走 content block；否则纯文本
        if (msg.attachments && msg.attachments.length > 0) {
          const blocks: any[] = [];
          for (const att of msg.attachments) {
            if (att.kind === 'image' && att.imageBase64 && att.imageMime) {
              blocks.push({
                type: 'image',
                source: {
                  type: 'base64',
                  media_type: att.imageMime,
                  data: att.imageBase64,
                },
              });
            } else if (att.textBlock) {
              blocks.push({
                type: 'text',
                text: `<attachment name="${att.filename}" kind="${att.kind}">\n${att.textBlock}\n</attachment>`,
              });
            }
          }
          blocks.push({ type: 'text', text: msg.content });
          anthropicMessages.push({ role: msg.role, content: blocks });
        } else {
          anthropicMessages.push({ role: msg.role, content: msg.content });
        }
      }
    }
    flushToolResults();

    return {
      system: systems.length > 0 ? systems.join('\n\n') : null,
      anthropicMessages,
    };
  }

  private normalizeFinishReason(
    reason: string,
  ): 'stop' | 'tool_calls' | 'length' | 'content_filter' | 'unknown' {
    // Anthropic stop_reason 映射:
    //   end_turn  → stop
    //   tool_use  → tool_calls
    //   max_tokens → length
    //   stop_sequence → stop
    //   refusal  → content_filter
    switch (reason) {
      case 'end_turn':
      case 'stop_sequence':
        return 'stop';
      case 'tool_use':
        return 'tool_calls';
      case 'max_tokens':
        return 'length';
      case 'refusal':
        return 'content_filter';
      default:
        return 'unknown';
    }
  }
}
