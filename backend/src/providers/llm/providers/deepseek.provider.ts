import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';
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
 * DeepSeek Provider
 * DeepSeek API 兼容 OpenAI SDK，只需修改 baseURL
 */
@Injectable()
export class DeepSeekProvider extends BaseLLMProvider {
  readonly providerName = LLMProvider.DEEPSEEK;
  private readonly logger = new Logger(DeepSeekProvider.name);
  private client: OpenAI | null = null;
  private defaultModel: string;

  constructor(private readonly configService: ConfigService) {
    super();
    const apiKey = this.configService.get<string>('app.llm.deepseek.apiKey');
    this.defaultModel =
      this.configService.get<string>('app.llm.deepseek.model') || 'deepseek-chat';

    if (!apiKey) {
      this.enabled = false;
      this.logger.warn('DeepSeek API key not configured; provider disabled');
      return;
    }

    this.client = new OpenAI({
      apiKey,
      baseURL: 'https://api.deepseek.com/v1',
    });
  }

  async callChat(messages: ChatMessage[], options?: LLMCallOptions): Promise<LLMResponse> {
    if (!this.client) {
      throw new Error('DeepSeek provider is not configured');
    }
    const start = Date.now();
    const model = options?.model || this.defaultModel;

    const response = await this.client.chat.completions.create({
      model,
      messages: messages.map((m) => ({ role: m.role, content: m.content })),
      temperature: options?.temperature ?? 0.2,
      max_tokens: options?.maxTokens,
      response_format: options?.jsonMode ? { type: 'json_object' } : undefined,
    });

    const choice = response.choices?.[0];
    return {
      content: choice?.message?.content || '',
      provider: this.providerName,
      model,
      usage: response.usage
        ? {
            promptTokens: response.usage.prompt_tokens,
            completionTokens: response.usage.completion_tokens,
            totalTokens: response.usage.total_tokens,
          }
        : undefined,
      latencyMs: Date.now() - start,
      raw: response,
    };
  }

  async callWithTools(
    messages: ConversationMessage[],
    tools: ToolDeclaration[],
    options?: LLMCallOptions,
  ): Promise<LLMToolResponse> {
    if (!this.client) throw new Error('DeepSeek provider is not configured');
    const start = Date.now();
    const model = options?.model || this.defaultModel;

    const openaiMessages = messages.map((m) => {
      if (m.role === 'tool') {
        return { role: 'tool' as const, tool_call_id: m.toolCallId, content: m.content };
      }
      if (m.role === 'assistant' && 'toolCalls' in m && m.toolCalls?.length) {
        return {
          role: 'assistant' as const,
          content: m.content || null,
          tool_calls: m.toolCalls.map((tc) => ({
            id: tc.id,
            type: 'function' as const,
            function: { name: tc.name, arguments: JSON.stringify(tc.arguments) },
          })),
        };
      }
      return { role: (m as ChatMessage).role, content: (m as ChatMessage).content };
    });

    const response = await this.client.chat.completions.create({
      model,
      messages: openaiMessages as any,
      temperature: options?.temperature ?? 0.1,
      max_tokens: options?.maxTokens,
      tools: tools.map((t) => ({
        type: 'function',
        function: { name: t.name, description: t.description, parameters: t.parameters },
      })),
      tool_choice: 'auto',
    });
    const latencyMs = Date.now() - start;
    const choice = response.choices?.[0];
    const toolCalls = choice?.message?.tool_calls || [];
    const usageNorm = response.usage
      ? {
          promptTokens: response.usage.prompt_tokens,
          completionTokens: response.usage.completion_tokens,
          totalTokens: response.usage.total_tokens,
        }
      : undefined;

    if (toolCalls.length > 0) {
      return {
        type: 'tool_calls',
        toolCalls: toolCalls.map((tc) => ({
          id: tc.id,
          name: tc.function.name,
          arguments: this.safeJsonParse(tc.function.arguments),
        })),
        content: choice?.message?.content || undefined,
        provider: this.providerName,
        model,
        usage: usageNorm,
        latencyMs,
        raw: response,
      };
    }
    return {
      type: 'message',
      content: choice?.message?.content || '',
      provider: this.providerName,
      model,
      usage: usageNorm,
      latencyMs,
      raw: response,
    };
  }

  /**
   * 流式 tool calling 实现。
   *
   * OpenAI 流式协议中：
   *   - delta.content 为文本增量
   *   - delta.tool_calls 是数组，每个有 index（稳定标识）；id/name 只在第一个 chunk 出现
   *   - function.arguments 是分片到达的 JSON 字符串
   *   - 最后 chunk 有 finish_reason 和 usage（启用 stream_options.include_usage）
   *
   * 我们按 index 做去重，第一次见到一个 index 就 yield tool_call_start，
   * 后续 args 增量 yield tool_call_args_delta，结束统一 yield tool_call_end。
   */
  async *streamWithTools(
    messages: ConversationMessage[],
    tools: ToolDeclaration[],
    options?: LLMCallOptions,
  ): AsyncGenerator<LLMStreamEvent, void, void> {
    if (!this.client) {
      yield { type: 'error', message: 'DeepSeek provider is not configured' };
      return;
    }
    const model = options?.model || this.defaultModel;

    const openaiMessages = messages.map((m) => {
      if (m.role === 'tool') {
        return { role: 'tool' as const, tool_call_id: m.toolCallId, content: m.content };
      }
      if (m.role === 'assistant' && 'toolCalls' in m && m.toolCalls?.length) {
        return {
          role: 'assistant' as const,
          content: m.content || null,
          tool_calls: m.toolCalls.map((tc) => ({
            id: tc.id,
            type: 'function' as const,
            function: { name: tc.name, arguments: JSON.stringify(tc.arguments) },
          })),
        };
      }
      return { role: (m as ChatMessage).role, content: (m as ChatMessage).content };
    });

    let stream;
    try {
      stream = await this.client.chat.completions.create({
        model,
        messages: openaiMessages as any,
        temperature: options?.temperature ?? 0.1,
        max_tokens: options?.maxTokens,
        tools: tools.map((t) => ({
          type: 'function',
          function: { name: t.name, description: t.description, parameters: t.parameters },
        })),
        tool_choice: 'auto',
        stream: true,
        stream_options: { include_usage: true },
      });
    } catch (err) {
      yield { type: 'error', message: (err as Error).message };
      return;
    }

    const indexToId = new Map<number, string>();
    let finishReason: string = 'unknown';
    let usage: { promptTokens: number; completionTokens: number; totalTokens: number } | undefined;

    try {
      for await (const chunk of stream) {
        const choice = chunk.choices?.[0];
        const delta: any = choice?.delta;

        if (delta?.content) {
          yield { type: 'text_delta', text: delta.content };
        }

        if (delta?.tool_calls) {
          for (const tc of delta.tool_calls) {
            const idx = tc.index;
            if (typeof idx !== 'number') continue;

            // 第一次见到这个 index → 一定带 id + name
            if (tc.id && !indexToId.has(idx)) {
              indexToId.set(idx, tc.id);
              yield {
                type: 'tool_call_start',
                id: tc.id,
                name: tc.function?.name || '',
              };
            }

            const stableId = indexToId.get(idx);
            if (stableId && tc.function?.arguments) {
              yield {
                type: 'tool_call_args_delta',
                id: stableId,
                argsDelta: tc.function.arguments,
              };
            }
          }
        }

        if (choice?.finish_reason) {
          finishReason = choice.finish_reason;
        }
        if (chunk.usage) {
          usage = {
            promptTokens: chunk.usage.prompt_tokens,
            completionTokens: chunk.usage.completion_tokens,
            totalTokens: chunk.usage.total_tokens,
          };
        }
      }
    } catch (err) {
      yield { type: 'error', message: `stream interrupted: ${(err as Error).message}` };
      return;
    }

    // 所有 tool call 结束
    for (const id of indexToId.values()) {
      yield { type: 'tool_call_end', id };
    }

    yield {
      type: 'message_end',
      finishReason: this.normalizeFinishReason(finishReason),
      usage,
    };
  }

  private normalizeFinishReason(reason: string): 'stop' | 'tool_calls' | 'length' | 'content_filter' | 'unknown' {
    if (reason === 'stop' || reason === 'tool_calls' || reason === 'length' || reason === 'content_filter') {
      return reason;
    }
    return 'unknown';
  }

  private safeJsonParse(text: string | undefined | null): Record<string, any> {
    if (!text) return {};
    try {
      return JSON.parse(text);
    } catch {
      return { __parse_error__: text };
    }
  }
}
