/**
 * useStreamingTurn — SSE 双向流的客户端状态机。
 *
 * 用法：
 *   const { state, startTurn, submitClarifyAnswer, reset } = useStreamingTurn();
 *   startTurn({ message, datasourceId, mode });
 *   // state.status 变化驱动 UI
 *   // state.pendingClarify 触发 ClarifyOverlay 弹出
 *   // state.finalize 出现 → 渲染最终结果（背景持久化到 DB 由后端完成）
 */
import React, { useCallback, useReducer, useRef } from 'react';
import { chatStream, RuntimeEvent, StartTurnPayload } from '@/services/chat-stream.service';

export type TurnStatus = 'idle' | 'streaming' | 'paused_clarify' | 'done' | 'error';

export interface ReasoningStep {
  step: number;
  toolName: string;
  args?: any;
  output?: any;
  durationMs?: number;
  error?: string;
  status: 'running' | 'done' | 'error';
}

export interface SubAgentRun {
  step: number;
  subAgentCallId?: string;
  skillName: string;
  subQuestion: string;
  reason?: string;
  narrative?: string;
  rowCount?: number;
  durationMs?: number;
  refused?: boolean;
  status: 'running' | 'done' | 'refused';
}

export interface ClarifyOption {
  value: string;
  pros?: string;
  cons?: string;
  recommended?: boolean;
}

export interface PendingClarify {
  question: string;
  options?: ClarifyOption[];
  reason?: string;
}

export interface FinalizeData {
  narrative: string;
  sql?: string;
  chartType?: string;
  confidence: number;
  refused?: boolean;
  insights?: any[];
  suggestedFollowUps?: string[];
  relatedHints?: string[];
  sqlResult?: {
    columns: { name: string; type: string }[];
    rows: Record<string, any>[];
    rowCount: number;
  };
}

export interface StreamingTurnState {
  status: TurnStatus;
  turnId: string | null;
  conversationId: string | null;
  userMessageId: string | null;
  /** Skill 名 (single_skill) 或 'master' */
  mode: 'single_skill' | 'master' | null;
  skill: { name: string; version: string } | null;
  steps: ReasoningStep[];
  subAgents: SubAgentRun[];
  totalTokens: number;
  /** 当前 LLM 调用 step 序号（in progress 时 > 0；done 时回到 0）*/
  llmThinking: number | null;
  pendingClarify: PendingClarify | null;
  /** 已确认的 clarify 答案，仅用于 UI 提示「✓ 已确认: X」*/
  resolvedClarifyAnswer: string | null;
  finalize: FinalizeData | null;
  errorMessage: string | null;
  /** 流开始的 wall-clock ms — 用于 UI 显示时长 */
  startedAt: number | null;
  /** 已处理的最大 _seq — 用于断线重连时去重 replay */
  lastSeenSeq: number;
  /** 当前是否处于重连中（短暂状态，UI 可显示「重连中」）*/
  reconnecting: boolean;
}

const initial: StreamingTurnState = {
  status: 'idle',
  turnId: null,
  conversationId: null,
  userMessageId: null,
  mode: null,
  skill: null,
  steps: [],
  subAgents: [],
  totalTokens: 0,
  llmThinking: null,
  pendingClarify: null,
  resolvedClarifyAnswer: null,
  finalize: null,
  errorMessage: null,
  startedAt: null,
  lastSeenSeq: -1,
  reconnecting: false,
};

type Action =
  | { type: 'RESET' }
  | {
      type: 'STARTED';
      turnId: string;
      conversationId: string;
      userMessageId: string;
      mode: 'single_skill' | 'master';
    }
  | { type: 'EVENT'; ev: RuntimeEvent }
  | { type: 'RECONNECTING' }
  | { type: 'RECONNECTED' }
  | { type: 'ABORTED'; reason?: string };

function reducer(state: StreamingTurnState, action: Action): StreamingTurnState {
  switch (action.type) {
    case 'RESET':
      return initial;
    case 'STARTED':
      return {
        ...initial,
        status: 'streaming',
        turnId: action.turnId,
        conversationId: action.conversationId,
        userMessageId: action.userMessageId,
        mode: action.mode,
        startedAt: Date.now(),
      };
    case 'ABORTED':
      return { ...state, status: 'error', errorMessage: action.reason || 'aborted' };
    case 'RECONNECTING':
      return { ...state, reconnecting: true };
    case 'RECONNECTED':
      return { ...state, reconnecting: false };
    case 'EVENT': {
      const ev = action.ev;
      // 断线重连后服务端会 replay 已发生事件 — 按 _seq 去重，避免双倍状态
      if (typeof ev._seq === 'number' && ev._seq <= state.lastSeenSeq) {
        return state;
      }
      const seqAdvance =
        typeof ev._seq === 'number' && ev._seq > state.lastSeenSeq
          ? { lastSeenSeq: ev._seq }
          : {};
      const merged = { ...state, ...seqAdvance };
      state = merged; // 让下面 switch case 用更新后的 lastSeenSeq
      switch (ev.type) {
        case 'turn_start':
          return { ...state, skill: ev.skill };
        case 'llm_call_start':
        case 'master_llm_call_start':
          return { ...state, llmThinking: ev.step };
        case 'llm_call_end':
        case 'master_llm_call_end':
          return {
            ...state,
            llmThinking: null,
            totalTokens: state.totalTokens + (ev.tokens || 0),
          };
        case 'tool_executing': {
          // 新 step 加入 steps；如果同 step+tool 已存在（流重连 replay），保留
          const exists = state.steps.find(
            (s) => s.step === ev.step && s.toolName === ev.toolName,
          );
          if (exists) return state;
          return {
            ...state,
            steps: [
              ...state.steps,
              { step: ev.step, toolName: ev.toolName, args: ev.args, status: 'running' },
            ],
          };
        }
        case 'tool_result': {
          // 更新对应 step 的 output / status
          return {
            ...state,
            steps: state.steps.map((s) =>
              s.step === ev.step && s.toolName === ev.toolName
                ? {
                    ...s,
                    output: ev.output,
                    durationMs: ev.durationMs,
                    error: ev.error,
                    status: ev.error ? 'error' : 'done',
                  }
                : s,
            ),
          };
        }
        case 'master_tool_executing': {
          const exists = state.steps.find(
            (s) => s.step === ev.step && s.toolName === ev.name,
          );
          if (exists) return state;
          return {
            ...state,
            steps: [
              ...state.steps,
              { step: ev.step, toolName: ev.name, args: ev.args, status: 'running' },
            ],
          };
        }
        case 'master_tool_result':
          return {
            ...state,
            steps: state.steps.map((s) =>
              s.step === ev.step && s.toolName === ev.name
                ? { ...s, output: ev.output, durationMs: ev.durationMs, status: 'done' }
                : s,
            ),
          };
        case 'sub_agent_dispatch':
          return {
            ...state,
            subAgents: [
              ...state.subAgents,
              {
                step: ev.step,
                skillName: ev.skillName,
                subQuestion: ev.subQuestion,
                reason: ev.reason,
                status: 'running',
              },
            ],
          };
        case 'sub_agent_result':
          return {
            ...state,
            subAgents: state.subAgents.map((sa) =>
              sa.step === ev.step &&
              sa.skillName === ev.skillName &&
              sa.status === 'running'
                ? {
                    ...sa,
                    subAgentCallId: ev.subAgentCallId,
                    narrative: ev.narrative,
                    rowCount: ev.rowCount,
                    durationMs: ev.durationMs,
                    refused: ev.refused,
                    status: ev.refused ? 'refused' : 'done',
                  }
                : sa,
            ),
          };
        case 'clarify_request':
          return {
            ...state,
            status: 'paused_clarify',
            pendingClarify: {
              question: ev.clarify.question,
              options: (ev.clarify.options || []).map((o: any) =>
                typeof o === 'string' ? { value: o } : o,
              ),
              reason: ev.clarify.reason,
            },
          };
        case 'clarify_resolved':
          return {
            ...state,
            status: 'streaming',
            pendingClarify: null,
            resolvedClarifyAnswer: ev.answer,
          };
        case 'finalize':
          return {
            ...state,
            status: 'done',
            llmThinking: null,
            finalize: {
              ...ev.finalize,
              sqlResult: ev.sqlResult,
            } as FinalizeData,
          };
        case 'error':
          return { ...state, status: 'error', errorMessage: ev.message };
        default:
          return state;
      }
    }
    default:
      return state;
  }
}

/**
 * 自动重连 SSE 流。
 *
 * 后端 TurnRuntime.subscribe 总会先 replay 该 turn 已发生的所有事件给新订阅者，
 * 然后 tail 实时事件。前端用 _seq 去重，所以重连后状态保持一致。
 *
 * 终止条件：
 *   - 主动 abort（ctrl.signal.aborted）
 *   - 收到 finalize 或 error 事件（自然结束）
 *   - 重试上限（5 次）后才放弃
 */
async function runStreamWithReconnect(
  turnId: string,
  ctrl: AbortController,
  dispatch: React.Dispatch<Action>,
) {
  let attempt = 0;
  const MAX_ATTEMPTS = 5;
  let lastEventType: string | null = null;

  while (!ctrl.signal.aborted && attempt < MAX_ATTEMPTS) {
    try {
      for await (const ev of chatStream.openStream(turnId, ctrl.signal)) {
        dispatch({ type: 'EVENT', ev });
        lastEventType = ev.type;
        if (attempt > 0) {
          // 第一个 event 收到 → 重连成功
          dispatch({ type: 'RECONNECTED' });
          attempt = 0;
        }
      }
      // 流自然结束（服务端 close subject）
      return;
    } catch (err) {
      if ((err as any).name === 'AbortError' || ctrl.signal.aborted) return;
      // 网络抖动 / 后端临时断开 — 重连
      if (lastEventType === 'finalize' || lastEventType === 'error') {
        // 终态已收，无需重连
        return;
      }
      attempt++;
      dispatch({ type: 'RECONNECTING' });
      const backoff = Math.min(1000 * 2 ** (attempt - 1), 8000); // 1s → 2s → 4s → 8s → 8s
      await new Promise<void>((resolve, reject) => {
        const t = setTimeout(resolve, backoff);
        ctrl.signal.addEventListener('abort', () => {
          clearTimeout(t);
          reject(new Error('AbortError'));
        });
      }).catch(() => {});
      if (ctrl.signal.aborted) return;
    }
  }
  if (attempt >= MAX_ATTEMPTS) {
    dispatch({
      type: 'ABORTED',
      reason: `连接中断，已重试 ${MAX_ATTEMPTS} 次仍失败`,
    });
  }
}

export function useStreamingTurn() {
  const [state, dispatch] = useReducer(reducer, initial);
  const abortRef = useRef<AbortController | null>(null);

  const startTurn = useCallback(async (payload: StartTurnPayload) => {
    dispatch({ type: 'RESET' });
    let started: { turnId: string; conversationId: string; userMessageId: string };
    try {
      started = await chatStream.startTurn(payload);
    } catch (err) {
      dispatch({
        type: 'ABORTED',
        reason: (err as Error).message || 'start failed',
      });
      return null;
    }
    dispatch({
      type: 'STARTED',
      turnId: started.turnId,
      conversationId: started.conversationId,
      userMessageId: started.userMessageId,
      mode: payload.mode || 'single_skill',
    });

    // 开 SSE 流（后台跑，含自动重连）
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;

    void runStreamWithReconnect(started.turnId, ctrl, dispatch);

    return started;
  }, []);

  const submitClarifyAnswer = useCallback(
    async (answer: string) => {
      if (!state.turnId) return;
      try {
        await chatStream.submitAnswer(state.turnId, answer);
        // 服务端续推 generator，前端 SSE 流会自动收到 clarify_resolved + 后续事件
      } catch (err) {
        dispatch({ type: 'ABORTED', reason: (err as Error).message });
      }
    },
    [state.turnId],
  );

  const reset = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    dispatch({ type: 'RESET' });
  }, []);

  return { state, startTurn, submitClarifyAnswer, reset };
}
