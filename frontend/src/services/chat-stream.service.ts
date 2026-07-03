/**
 * Chat SSE 客户端 — Claude-style 双向流。
 *
 * 用 fetch + ReadableStream 手动解析 SSE（EventSource 不支持自定义 Authorization header）。
 *
 * 三端点：
 *   POST /chat/stream/start         → 创建 turn，返回 turnId
 *   GET  /chat/stream/:turnId       → SSE 流（replay + tail）
 *   POST /chat/stream/:turnId/answer → 续推 clarify
 */
import { api } from '@/lib/api';
import { authStorage } from '@/lib/auth-storage';

const baseURL = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:3000/api';

export type RuntimeEvent =
  | { type: 'turn_start'; skill: { name: string; version: string }; _seq?: number }
  | { type: 'llm_call_start'; step: number; _seq?: number }
  | { type: 'llm_call_end'; step: number; tokens?: number; _seq?: number }
  | { type: 'tool_executing'; step: number; toolName: string; args: any; _seq?: number }
  | {
      type: 'tool_result';
      step: number;
      toolName: string;
      output: any;
      durationMs: number;
      error?: string;
      _seq?: number;
    }
  | {
      type: 'clarify_request';
      clarify: {
        question: string;
        options?: Array<
          string | { value: string; pros?: string; cons?: string; recommended?: boolean }
        >;
        reason?: string;
      };
      _seq?: number;
    }
  | { type: 'clarify_resolved'; answer: string; _seq?: number }
  | {
      type: 'finalize';
      finalize: {
        narrative: string;
        sql?: string;
        chartType?: string;
        confidence: number;
        refused?: boolean;
        insights?: any[];
        suggestedFollowUps?: string[];
        relatedHints?: string[];
        clarify?: any;
      };
      sqlResult?: {
        columns: { name: string; type: string }[];
        rows: Record<string, any>[];
        rowCount: number;
      };
      _seq?: number;
    }
  | {
      /** Verifier 评分完成 — 前端可显示 5 维度 rubric 分数 */
      type: 'verifier_check';
      attempt: number;
      review: {
        confidence: number;
        dimensions: {
          answersQuestion: number;
          sqlConsistency: number;
          joinCompleteness: number;
          numericalPrecision: number;
          noHallucination: number;
        };
        shouldRetry: boolean;
        shouldRefuse: boolean;
        concerns: string[];
        feedback: string;
        summary: string;
      };
      _seq?: number;
    }
  | {
      /** Verifier 判定返工 — 前端可显示"AI 正在修正答案" */
      type: 'verifier_retry';
      attempt: number;
      reason: string;
      _seq?: number;
    }
  | { type: 'error'; message: string; _seq?: number }
  // Master 路径
  | { type: 'master_start'; _seq?: number }
  | { type: 'master_llm_call_start'; step: number; _seq?: number }
  | { type: 'master_llm_call_end'; step: number; tokens?: number; _seq?: number }
  | {
      type: 'sub_agent_dispatch';
      step: number;
      skillName: string;
      subQuestion: string;
      reason?: string;
      _seq?: number;
    }
  | {
      type: 'sub_agent_result';
      step: number;
      subAgentCallId: string;
      skillName: string;
      narrative: string;
      rowCount: number;
      durationMs: number;
      refused: boolean;
      _seq?: number;
    }
  | { type: 'master_tool_executing'; step: number; name: string; args: any; _seq?: number }
  | { type: 'master_tool_result'; step: number; name: string; output: any; durationMs: number; _seq?: number };

export interface StartTurnPayload {
  message: string;
  datasourceId: string;
  conversationId?: string;
  projectId?: string;
  mode?: 'single_skill' | 'master';
  clarifyReplyToMessageId?: string;
  /** 用户上传 dataset 模式：限定 chat 仅查这些 dataset（强权限隔离）*/
  datasetIds?: string[];
  /** 企业模式的「分析范围」— 用户预选的表（含 schema，如 "dwd.orders"）*/
  analyzedTables?: string[];
  /** 本轮附件 id（先 POST /v1/chat/attachments 上传后得到）*/
  attachmentIds?: string[];
}

export interface StartTurnResponse {
  turnId: string;
  conversationId: string;
  userMessageId: string;
}

export const chatStream = {
  /** 创建 turn — 后端 spawn generator 后立即返回 */
  async startTurn(payload: StartTurnPayload): Promise<StartTurnResponse> {
    const { data } = await api.post<StartTurnResponse>('/v1/chat/stream/start', payload);
    return data;
  },

  /**
   * 打开 SSE 流。Returns an async iterable of events; consumer can `for await` or use
   * the abort signal to stop early.
   *
   * 自动 replay 已发生事件（断线重连无损） + tail 实时事件。
   */
  async *openStream(
    turnId: string,
    signal?: AbortSignal,
  ): AsyncIterable<RuntimeEvent> {
    const token = authStorage.getAccessToken();
    const res = await fetch(`${baseURL}/v1/chat/stream/${turnId}`, {
      headers: {
        Accept: 'text/event-stream',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      signal,
    });
    if (!res.ok || !res.body) {
      throw new Error(`SSE stream failed: HTTP ${res.status}`);
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        let nlIdx;
        while ((nlIdx = buffer.indexOf('\n\n')) !== -1) {
          const raw = buffer.slice(0, nlIdx);
          buffer = buffer.slice(nlIdx + 2);

          const dataLines = raw
            .split('\n')
            .filter((l) => l.startsWith('data:'))
            .map((l) => l.slice(5).trimStart());
          if (dataLines.length === 0) continue;
          const dataStr = dataLines.join('\n');
          if (!dataStr) continue;

          let ev: RuntimeEvent;
          try {
            ev = JSON.parse(dataStr) as RuntimeEvent;
          } catch {
            continue;
          }
          yield ev;

          if (ev.type === 'finalize' || ev.type === 'error') {
            return;
          }
        }
      }
    } finally {
      try {
        reader.releaseLock();
      } catch {
        /* noop */
      }
    }
  },

  /** 提供 clarify 答案 — 后端 generator 续推 */
  async submitAnswer(turnId: string, answer: string): Promise<{ ok: boolean; reason?: string }> {
    const { data } = await api.post<{ ok: boolean; reason?: string }>(
      `/v1/chat/stream/${turnId}/answer`,
      { answer },
    );
    return data;
  },
};
