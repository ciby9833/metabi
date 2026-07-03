import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';
import { BaseLLMProvider } from './base.provider';
import {
  ChatMessage,
  ConversationMessage,
  EmbeddingResponse,
  LLMCallOptions,
  LLMProvider,
  LLMResponse,
  LLMStreamEvent,
  LLMToolResponse,
  ToolDeclaration,
} from '../types';

@Injectable()
export class OpenAIProvider extends BaseLLMProvider {
  readonly providerName = LLMProvider.OPENAI;
  private readonly logger = new Logger(OpenAIProvider.name);
  private client: OpenAI | null = null;
  private defaultModel: string;
  private timeoutMs: number;

  constructor(private readonly configService: ConfigService) {
    super();
    const apiKey = this.configService.get<string>('app.llm.openai.apiKey');
    this.defaultModel = this.configService.get<string>('app.llm.openai.model') || 'gpt-4o';
    this.timeoutMs = (this.configService.get<number>('app.llm.openai.timeout') || 60) * 1000;

    if (!apiKey) {
      this.enabled = false;
      this.logger.warn('OpenAI API key not configured; provider disabled');
      return;
    }

    this.client = new OpenAI({ apiKey, timeout: this.timeoutMs });
  }

  async callChat(messages: ChatMessage[], options?: LLMCallOptions): Promise<LLMResponse> {
    if (!this.client) {
      throw new Error('OpenAI provider is not configured');
    }
    const start = Date.now();
    const model = options?.model || this.defaultModel;
    const params: OpenAI.Chat.ChatCompletionCreateParamsNonStreaming = {
      model,
      messages: messages.map((m) => ({ role: m.role, content: m.content })),
      temperature: options?.temperature ?? 0.2,
      max_tokens: options?.maxTokens,
    };
    if (options?.jsonMode) {
      params.response_format = { type: 'json_object' };
    }

    const response = await this.client.chat.completions.create(params);
    const latencyMs = Date.now() - start;
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
      latencyMs,
      raw: response,
    };
  }

  async callWithTools(
    messages: ConversationMessage[],
    tools: ToolDeclaration[],
    options?: LLMCallOptions,
  ): Promise<LLMToolResponse> {
    if (!this.client) {
      throw new Error('OpenAI provider is not configured');
    }
    const start = Date.now();
    const model = options?.model || this.defaultModel;

    const openaiMessages = messages.map((m) => {
      if (m.role === 'tool') {
        return {
          role: 'tool' as const,
          tool_call_id: m.toolCallId,
          content: m.content,
        };
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

    const params: OpenAI.Chat.ChatCompletionCreateParamsNonStreaming = {
      model,
      messages: openaiMessages as any,
      temperature: options?.temperature ?? 0.1,
      max_tokens: options?.maxTokens,
      tools: tools.map((t) => ({
        type: 'function',
        function: { name: t.name, description: t.description, parameters: t.parameters },
      })),
      tool_choice: 'auto',
    };

    const response = await this.client.chat.completions.create(params);
    const latencyMs = Date.now() - start;
    const choice = response.choices?.[0];
    const toolCalls = choice?.message?.tool_calls || [];

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
        usage: response.usage
          ? {
              promptTokens: response.usage.prompt_tokens,
              completionTokens: response.usage.completion_tokens,
              totalTokens: response.usage.total_tokens,
            }
          : undefined,
        latencyMs,
        raw: response,
      };
    }

    return {
      type: 'message',
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
      latencyMs,
      raw: response,
    };
  }

  /**
   * 流式 tool calling — 协议同 DeepSeek（都基于 OpenAI SDK）。
   * 按 index 去重 tool_calls，args 分片转发。
   */
  async *streamWithTools(
    messages: ConversationMessage[],
    tools: ToolDeclaration[],
    options?: LLMCallOptions,
  ): AsyncGenerator<LLMStreamEvent, void, void> {
    if (!this.client) {
      yield { type: 'error', message: 'OpenAI provider is not configured' };
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
            if (tc.id && !indexToId.has(idx)) {
              indexToId.set(idx, tc.id);
              yield { type: 'tool_call_start', id: tc.id, name: tc.function?.name || '' };
            }
            const stableId = indexToId.get(idx);
            if (stableId && tc.function?.arguments) {
              yield { type: 'tool_call_args_delta', id: stableId, argsDelta: tc.function.arguments };
            }
          }
        }
        if (choice?.finish_reason) finishReason = choice.finish_reason;
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

  async embed(text: string): Promise<EmbeddingResponse> {
    if (!this.client) {
      throw new Error('OpenAI provider is not configured');
    }
    const model = this.configService.get<string>('app.vector.model') || 'text-embedding-3-small';
    const response = await this.client.embeddings.create({ model, input: text });
    const vector = response.data[0]?.embedding || [];
    return { vector, model, dimensions: vector.length };
  }
}
