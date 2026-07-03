/**
 * Eval Harness — 类型定义
 *
 * 设计原则：
 *   - Eval Task 是「声明式」的 — 描述输入 + 期望，不包含执行逻辑
 *   - Runner 把 Task 喂给真实的 chat pipeline（不 mock），保证测的是生产代码
 *   - Judge 不依赖 LLM，纯规则判断（避免"用 LLM 评 LLM"的循环）
 *
 * Inspired by:
 *   - OpenAI evals (https://github.com/openai/evals)
 *   - Anthropic "Building Effective Agents" 测试理念
 */

/** 单个 Eval 任务的输入 + 期望 */
export interface EvalTask {
  id: string;
  /** 分类便于按 tag 跑 */
  category:
    | 'dataset_simple_agg'
    | 'dataset_multi_table_join'
    | 'dataset_time_series'
    | 'dataset_top_n'
    | 'dataset_ratio'
    | 'dataset_exploration'
    | 'dataset_chinese_term'
    | 'dataset_edge_case'
    | 'enterprise_basic'
    | 'enterprise_complex';
  /** 描述（报告里显示）*/
  description: string;

  /** 运行前置：创建必要的 datasets */
  setup: EvalSetup;

  /** 用户问题 */
  question: string;

  /** 期望约束 */
  expected: EvalExpectation;
}

export interface EvalSetup {
  /** CSV/Excel 内嵌数据（避免依赖外部文件）*/
  datasets?: Array<{
    /** dataset 显示名 */
    name: string;
    /** 整体业务描述（注入 ProjectSkill）*/
    description?: string;
    /** CSV 字符串（含表头）*/
    csv: string;
    /** 列的业务描述（key=列名）*/
    columnDescriptions?: Record<string, string>;
  }>;
  /** 模式：dataset = 用户自助；enterprise = 企业 datasource */
  mode: 'dataset' | 'enterprise';
  /** enterprise 模式下用的 datasource id（可选）*/
  datasourceId?: string;
  /** agent 模式 */
  agentMode?: 'single_skill' | 'master';
}

export interface EvalExpectation {
  /** narrative 必须**全部**包含的子串（任一缺失则 fail；AND 语义）*/
  mustContain?: string[];
  /** narrative 必须**任一**包含的子串（全都缺失才 fail；OR 语义；用于"没有/0/无"这种多种表达都对的场景）*/
  mustContainAny?: string[];
  /** narrative 必须包含的数字（允许文本任意位置出现）*/
  mustContainNumbers?: Array<number | string>;
  /** narrative 不可包含的子串（出现即 fail）*/
  mustNotContain?: string[];

  /** SQL 必须用到的表 */
  sqlMustReferenceTable?: string[];
  /** SQL 应该包含 JOIN（多表场景）*/
  sqlMustContainJoin?: boolean;

  /** 必须用到的工具（任一未调用则 fail）*/
  toolsMustUse?: string[];
  /** 禁用的工具（任一调用则 fail）*/
  toolsMustNotUse?: string[];

  /** 步数上限（>= 视为 fail）*/
  maxSteps?: number;
  /** Token 上限 */
  maxTokens?: number;
  /** 延迟上限（ms）*/
  maxLatencyMs?: number;

  /** 不可拒答 */
  shouldNotRefuse?: boolean;
  /** SQL 必须执行成功（至少 1 次 run_sql 返回 rows）*/
  shouldHaveSqlResult?: boolean;
  /** SQL 结果至少包含 N 行（验证查到了数据）*/
  sqlResultMinRows?: number;
}

/** 单任务执行结果 */
export interface EvalResult {
  taskId: string;
  /** 任务分类（冗余 + 便于 report 分组）*/
  category: EvalTask['category'];
  passed: boolean;
  /** fail 原因（多条）；空数组 = 全通过 */
  failureReasons: string[];

  metrics: EvalMetrics;

  /** trace（前 N 个工具调用 + finalize narrative）— 排查用 */
  trace: {
    skillUsed: string;
    toolCalls: Array<{ step: number; toolName: string; argsPreview: string; durationMs: number }>;
    sqlExecuted: string[];
    narrative: string;
    refused: boolean;
    error?: string;
    /** Verifier 每次评估的详情（含 rubric 5 维度 + feedback）— 关键排查 */
    verifierReviews?: Array<{
      attempt: number;
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
    }>;
  };
}

export interface EvalMetrics {
  steps: number;
  totalTokens: number;
  latencyMs: number;
  sqlResultRowCount: number | null;
  /** Verifier 返工次数（0 = 一次过；max 通常 2）*/
  verifierRetries: number;
  /** 最终 Verifier 总置信度（0..1）；undefined = 未跑 verify */
  finalConfidence: number | null;
}

/** 一次完整 eval run 的汇总报告 */
export interface EvalReport {
  runId: string;
  startedAt: string;
  finishedAt: string;
  totalDurationMs: number;

  summary: {
    totalTasks: number;
    passed: number;
    failed: number;
    passRate: number; // 0..1
    avgSteps: number;
    avgTokens: number;
    avgLatencyMs: number;
    /** verify 真正返工的任务比例 */
    retryRate: number;
    /** 平均返工次数（含 0 次的）*/
    avgRetries: number;
    /** 每个 passed 任务平均花的 tokens（Anatoli: cost per accepted change）*/
    tokensPerAccepted: number;
  };

  byCategory: Record<
    string,
    {
      total: number;
      passed: number;
      avgSteps: number;
      avgTokens: number;
    }
  >;

  results: EvalResult[];
}
