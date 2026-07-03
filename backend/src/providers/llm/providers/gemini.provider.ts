import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
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
import * as crypto from 'crypto';

/**
 * Gemini Provider
 * 使用 Google Generative AI SDK 调用 Gemini 模型
 * 注意：实际生产中应使用 @google/generative-ai 包
 */
@Injectable()
export class GeminiProvider extends BaseLLMProvider {
  readonly providerName = LLMProvider.GEMINI;
  private readonly logger = new Logger(GeminiProvider.name);
  private apiKey?: string;
  private defaultModel: string;
  private baseUrl = 'https://generativelanguage.googleapis.com/v1beta';

  constructor(private readonly configService: ConfigService) {
    super();
    this.apiKey = this.configService.get<string>('app.llm.gemini.apiKey');
    this.defaultModel = this.configService.get<string>('app.llm.gemini.model') || 'gemini-2.5-pro';

    if (!this.apiKey) {
      this.enabled = false;
      this.logger.warn('Gemini API key not configured; provider disabled');
    }
  }

  async callChat(messages: ChatMessage[], options?: LLMCallOptions): Promise<LLMResponse> {
    if (!this.apiKey) {
      throw new Error('Gemini provider is not configured');
    }
    const start = Date.now();
    const model = options?.model || this.defaultModel;

    // Gemini API 格式转换
    const contents = messages
      .filter((m) => m.role !== 'system')
      .map((m) => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: m.content }],
      }));

    const systemInstruction = messages.find((m) => m.role === 'system');

    const body: any = {
      contents,
      generationConfig: {
        temperature: options?.temperature ?? 0.2,
        maxOutputTokens: options?.maxTokens,
      },
    };
    if (systemInstruction) {
      body.systemInstruction = { parts: [{ text: systemInstruction.content }] };
    }
    if (options?.jsonMode) {
      body.generationConfig.responseMimeType = 'application/json';
    }

    const url = `${this.baseUrl}/models/${model}:generateContent?key=${this.apiKey}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Gemini API error: ${res.status} ${text}`);
    }

    const data: any = await res.json();
    const content = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
    const usage = data.usageMetadata;

    return {
      content,
      provider: this.providerName,
      model,
      usage: usage
        ? {
            promptTokens: usage.promptTokenCount || 0,
            completionTokens: usage.candidatesTokenCount || 0,
            totalTokens: usage.totalTokenCount || 0,
          }
        : undefined,
      latencyMs: Date.now() - start,
      raw: data,
    };
  }

  async callWithTools(
    messages: ConversationMessage[],
    tools: ToolDeclaration[],
    options?: LLMCallOptions,
  ): Promise<LLMToolResponse> {
    if (!this.apiKey) throw new Error('Gemini provider is not configured');
    const start = Date.now();
    const model = options?.model || this.defaultModel;

    // Gemini contents
    const contents: any[] = [];
    for (const m of messages) {
      if (m.role === 'system') continue;
      if (m.role === 'tool') {
        contents.push({
          role: 'user',
          parts: [
            {
              functionResponse: {
                name: m.toolName,
                response: this.safeJsonParse(m.content),
              },
            },
          ],
        });
        continue;
      }
      if (m.role === 'assistant' && 'toolCalls' in m && m.toolCalls?.length) {
        contents.push({
          role: 'model',
          parts: m.toolCalls.map((tc) => {
            const part: any = {
              functionCall: { name: tc.name, args: tc.arguments },
            };
            // Gemini 2.5+ 要求回传 thoughtSignature
            if (tc.thoughtSignature) {
              part.thoughtSignature = tc.thoughtSignature;
            }
            return part;
          }),
        });
        continue;
      }
      const cm = m as ChatMessage;
      contents.push({
        role: cm.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: cm.content }],
      });
    }

    const systemMsg = messages.find((m) => (m as ChatMessage).role === 'system') as
      | ChatMessage
      | undefined;

    const body: any = {
      contents,
      tools: [
        {
          functionDeclarations: tools.map((t) => ({
            name: t.name,
            description: t.description,
            parameters: this.sanitizeSchema(t.parameters),
          })),
        },
      ],
      toolConfig: { functionCallingConfig: { mode: 'AUTO' } },
      generationConfig: {
        temperature: options?.temperature ?? 0.1,
        maxOutputTokens: options?.maxTokens,
      },
    };
    if (systemMsg) {
      body.systemInstruction = { parts: [{ text: systemMsg.content }] };
    }

    const url = `${this.baseUrl}/models/${model}:generateContent?key=${this.apiKey}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Gemini API error: ${res.status} ${text}`);
    }
    const data: any = await res.json();
    const candidate = data.candidates?.[0];
    const parts = candidate?.content?.parts || [];
    const functionCalls: any[] = parts.filter((p: any) => p.functionCall);
    const textParts: string[] = parts.filter((p: any) => p.text).map((p: any) => p.text);
    const usage = data.usageMetadata;
    const usageNorm = usage
      ? {
          promptTokens: usage.promptTokenCount || 0,
          completionTokens: usage.candidatesTokenCount || 0,
          totalTokens: usage.totalTokenCount || 0,
        }
      : undefined;

    if (functionCalls.length > 0) {
      return {
        type: 'tool_calls',
        toolCalls: functionCalls.map((fc: any) => ({
          id: `gem_${crypto.randomBytes(6).toString('hex')}`,
          name: fc.functionCall.name,
          arguments: fc.functionCall.args || {},
          // 关键：捕获 Gemini 2.5+ 的 thoughtSignature 以便下一轮回传
          thoughtSignature: fc.thoughtSignature,
        })),
        content: textParts.join('\n') || undefined,
        provider: this.providerName,
        model,
        usage: usageNorm,
        latencyMs: Date.now() - start,
        raw: data,
      };
    }

    return {
      type: 'message',
      content: textParts.join('\n'),
      provider: this.providerName,
      model,
      usage: usageNorm,
      latencyMs: Date.now() - start,
      raw: data,
    };
  }

  /**
   * Gemini 流式 tool calling — 用 :streamGenerateContent?alt=sse endpoint。
   * Gemini SSE 每个事件是一个完整的 candidate 增量；functionCall 通常**一次性完整**到达
   * （不像 OpenAI 那样 args 分片），所以一个工具调用对应一组 start → 完整 args → end。
   */
  async *streamWithTools(
    messages: ConversationMessage[],
    tools: ToolDeclaration[],
    options?: LLMCallOptions,
  ): AsyncGenerator<LLMStreamEvent, void, void> {
    if (!this.apiKey) {
      yield { type: 'error', message: 'Gemini provider is not configured' };
      return;
    }
    const model = options?.model || this.defaultModel;

    // 复用 callWithTools 的 contents/body 构造
    const contents: any[] = [];
    for (const m of messages) {
      if (m.role === 'system') continue;
      if (m.role === 'tool') {
        contents.push({
          role: 'user',
          parts: [
            {
              functionResponse: { name: m.toolName, response: this.safeJsonParse(m.content) },
            },
          ],
        });
        continue;
      }
      if (m.role === 'assistant' && 'toolCalls' in m && m.toolCalls?.length) {
        contents.push({
          role: 'model',
          parts: m.toolCalls.map((tc) => {
            const part: any = { functionCall: { name: tc.name, args: tc.arguments } };
            if (tc.thoughtSignature) part.thoughtSignature = tc.thoughtSignature;
            return part;
          }),
        });
        continue;
      }
      const cm = m as ChatMessage;
      contents.push({
        role: cm.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: cm.content }],
      });
    }
    const systemMsg = messages.find((m) => (m as ChatMessage).role === 'system') as
      | ChatMessage
      | undefined;
    const body: any = {
      contents,
      tools: [
        {
          functionDeclarations: tools.map((t) => ({
            name: t.name,
            description: t.description,
            parameters: this.sanitizeSchema(t.parameters),
          })),
        },
      ],
      toolConfig: { functionCallingConfig: { mode: 'AUTO' } },
      generationConfig: {
        temperature: options?.temperature ?? 0.1,
        maxOutputTokens: options?.maxTokens,
      },
    };
    if (systemMsg) body.systemInstruction = { parts: [{ text: systemMsg.content }] };

    const url = `${this.baseUrl}/models/${model}:streamGenerateContent?alt=sse&key=${this.apiKey}`;
    let res: Response;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
    } catch (err) {
      yield { type: 'error', message: (err as Error).message };
      return;
    }
    if (!res.ok || !res.body) {
      const text = await res.text().catch(() => '');
      yield { type: 'error', message: `Gemini stream failed: ${res.status} ${text}` };
      return;
    }

    let finishReason: string = 'unknown';
    let usage: { promptTokens: number; completionTokens: number; totalTokens: number } | undefined;
    let promptTokens = 0;
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        // SSE 解析：以双换行切分事件，每事件多行 data: ... 拼接
        let nlIdx;
        while ((nlIdx = buffer.indexOf('\n\n')) !== -1) {
          const rawEvent = buffer.slice(0, nlIdx);
          buffer = buffer.slice(nlIdx + 2);

          const dataLines = rawEvent
            .split('\n')
            .filter((l) => l.startsWith('data:'))
            .map((l) => l.slice(5).trimStart());
          if (dataLines.length === 0) continue;
          const dataStr = dataLines.join('\n');
          if (!dataStr || dataStr === '[DONE]') continue;

          let chunk: any;
          try {
            chunk = JSON.parse(dataStr);
          } catch {
            continue;
          }

          const candidate = chunk.candidates?.[0];
          const parts = candidate?.content?.parts || [];
          for (const part of parts) {
            if (part.text) {
              yield { type: 'text_delta', text: part.text };
            }
            if (part.functionCall) {
              const id = `gem_${crypto.randomBytes(6).toString('hex')}`;
              yield {
                type: 'tool_call_start',
                id,
                name: part.functionCall.name,
                thoughtSignature: part.thoughtSignature,
              };
              // Gemini 工具参数一次性到达 — 整段 JSON 一次发完
              yield {
                type: 'tool_call_args_delta',
                id,
                argsDelta: JSON.stringify(part.functionCall.args || {}),
              };
              yield { type: 'tool_call_end', id };
            }
          }

          if (candidate?.finishReason) {
            finishReason = candidate.finishReason;
          }
          const um = chunk.usageMetadata;
          if (um) {
            promptTokens = um.promptTokenCount || promptTokens;
            usage = {
              promptTokens,
              completionTokens: um.candidatesTokenCount || 0,
              totalTokens: um.totalTokenCount || (promptTokens + (um.candidatesTokenCount || 0)),
            };
          }
        }
      }
    } catch (err) {
      yield { type: 'error', message: `stream interrupted: ${(err as Error).message}` };
      return;
    }

    yield {
      type: 'message_end',
      finishReason: this.normalizeFinishReason(finishReason),
      usage,
    };
  }

  private normalizeFinishReason(reason: string): 'stop' | 'tool_calls' | 'length' | 'content_filter' | 'unknown' {
    // Gemini finishReason: STOP / MAX_TOKENS / SAFETY / RECITATION / OTHER
    switch (reason) {
      case 'STOP':
        return 'stop';
      case 'MAX_TOKENS':
        return 'length';
      case 'SAFETY':
      case 'RECITATION':
        return 'content_filter';
      default:
        return 'unknown';
    }
  }

  private safeJsonParse(text: string | undefined | null): any {
    if (!text) return {};
    try {
      return JSON.parse(text);
    } catch {
      return { content: text };
    }
  }

  /**
   * Gemini 不支持 JSON Schema 的 additionalProperties / 部分关键字，需要剥掉
   */
  private sanitizeSchema(schema: any): any {
    if (!schema || typeof schema !== 'object') return schema;
    if (Array.isArray(schema)) return schema.map((s) => this.sanitizeSchema(s));
    const { additionalProperties, $schema, ...rest } = schema;
    const out: any = {};
    for (const [k, v] of Object.entries(rest)) {
      out[k] = this.sanitizeSchema(v as any);
    }
    return out;
  }
}
