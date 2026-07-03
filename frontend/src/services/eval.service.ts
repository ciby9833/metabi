/**
 * Admin Eval History SDK — 只有 admin 能调
 */
import { api } from '@/lib/api';

export interface EvalRunSummary {
  runId: string;
  filename: string;
  startedAt: string;
  finishedAt: string;
  totalDurationMs: number;
  totalTasks: number;
  passed: number;
  failed: number;
  passRate: number;
  avgSteps: number;
  avgTokens: number;
  avgLatencyMs: number;
  retryRate: number;
  avgRetries: number;
  tokensPerAccepted: number;
}

export interface EvalRunDetail {
  runId: string;
  startedAt: string;
  finishedAt: string;
  totalDurationMs: number;
  summary: any;
  byCategory: Record<string, any>;
  results: Array<{
    taskId: string;
    category: string;
    passed: boolean;
    failureReasons: string[];
    metrics: {
      steps: number;
      totalTokens: number;
      latencyMs: number;
      sqlResultRowCount: number | null;
      verifierRetries: number;
      finalConfidence: number | null;
    };
    trace: {
      skillUsed: string;
      toolCalls: Array<{ step: number; toolName: string; argsPreview: string; durationMs: number }>;
      sqlExecuted: string[];
      narrative: string;
      refused: boolean;
      error?: string;
      verifierReviews?: Array<{
        attempt: number;
        confidence: number;
        dimensions: any;
        shouldRetry: boolean;
        shouldRefuse: boolean;
        concerns: string[];
        feedback: string;
        summary: string;
      }>;
    };
  }>;
}

export const evalService = {
  async list(): Promise<EvalRunSummary[]> {
    const res = await api.get<EvalRunSummary[]>('/v1/admin/eval-runs');
    return res.data;
  },

  async detail(runId: string): Promise<EvalRunDetail> {
    const res = await api.get<EvalRunDetail>(`/v1/admin/eval-runs/${runId}`);
    return res.data;
  },
};
