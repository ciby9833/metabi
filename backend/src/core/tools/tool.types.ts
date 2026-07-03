/**
 * Tool 通用接口
 *
 * 每个 Tool = (name, description, JSON-schema parameters, execute function)
 * 设计成 OpenAI / Gemini / Anthropic 通用 schema，方便后续无缝切换 LLM。
 */

/** JSON Schema for tool parameters (subset, enough for our needs) */
export type JsonSchema =
  | { type: 'string'; description?: string; enum?: string[] }
  | { type: 'number' | 'integer'; description?: string; minimum?: number; maximum?: number }
  | { type: 'boolean'; description?: string }
  | {
      type: 'object';
      properties: Record<string, JsonSchema>;
      required?: string[];
      description?: string;
      additionalProperties?: boolean;
    }
  | { type: 'array'; items: JsonSchema; description?: string };

/**
 * Tool 在哪些场景可见。设计原则（context-align）：
 *   - 不"硬控制" LLM 行为，而是按"工具是否在此模式有意义"决定暴露
 *   - 默认 'both'：所有现存工具不需声明仍可用（向后兼容）
 *   - 加新工具时只需打标签 → Planner 自动过滤；无需改任何 hardcode
 */
export type ToolAvailability = 'enterprise_only' | 'dataset_only' | 'both';

export interface ToolDefinition {
  /** 全局唯一名称（snake_case），LLM 看到的名字 */
  name: string;
  /** 给 LLM 看的描述：什么时候用、注意什么 */
  description: string;
  /** 入参 JSON Schema */
  parameters: JsonSchema;
  /**
   * 可选：限定工具在哪种数据模式可见（默认 'both'）。
   * - enterprise_only: 仅企业数据源场景（如 list_tables / search_tables 这些需要库内大量元数据搜索的）
   * - dataset_only:    仅用户上传 dataset 自助分析场景（如 export_excel 等输出类）
   * - both:            两种模式都可用（默认）
   *
   * Planner 按此过滤工具集 → LLM 只看到合适的工具集 → 自然不会乱调
   */
  availability?: ToolAvailability;
}

/** Tool 调用的运行上下文（不暴露给 LLM）*/
export interface ToolContext {
  datasourceId: string;
  /** 运行轨迹，写入 provenance footer */
  log: ToolCallLog[];
  /** 用于审计的额外信息 */
  conversationId?: string;
  userId?: string;
  /** @deprecated 已分拆为 dryRunCount + successfulSqlRuns */
  sqlCallCount?: number;
  /** 累计 dry_run 次数 */
  dryRunCount?: number;
  /** 累计真跑次数（含成功/失败）*/
  successfulSqlRuns?: number;
  /**
   * 当前会话锁定的 Skill 允许访问的表白名单（含 schema 前缀）
   * 若为 undefined / 空数组则不限制
   * list_tables / describe_table / sample_rows / run_sql 都会做匹配
   */
  allowedTables?: string[];
  /**
   * 当前会话锁定的 Skill 元信息 + body（markdown 全文）。
   * cite_industry_benchmark 等"知识型工具"从这里抽段落，
   * 避免再次去 DB 取 Skill。
   */
  skill?: {
    name: string;
    version: string;
    body: string;
  };
}

export interface ToolCallLog {
  /** 步骤序号 */
  step: number;
  /** Tool 名 */
  name: string;
  /** 入参 */
  input: any;
  /** 出参（摘要，避免大对象进日志） */
  output: any;
  /** 耗时 */
  durationMs: number;
  /** 错误信息（如果有）*/
  error?: string;
  /** 时间戳 */
  timestamp: string;
}

/**
 * Agent 用的 Tool 实例：定义 + 执行逻辑
 */
export interface AgentTool<TInput = any, TOutput = any> {
  readonly definition: ToolDefinition;
  execute(input: TInput, ctx: ToolContext): Promise<TOutput>;
}

export type InsightSeverity = 'info' | 'warning' | 'critical';

export interface Insight {
  severity: InsightSeverity;
  /** 一两句话说明发现的点 */
  text: string;
  /** 类型标签，便于前端图标/筛选 */
  kind?: 'anomaly' | 'concentration' | 'data_quality' | 'trend' | 'business' | 'attribution';
}

/**
 * 澄清请求：Agent 遇到无法决断的关键歧义时返回，前端渲染为可点击卡片。
 * 用户的选择/输入会作为下一条消息自动发送。
 */
/**
 * 候选选项 — 支持 string 简写 或 对象（带优劣评注）
 * 推荐用对象形式，给用户更明确的决策依据。
 */
export type ClarifyOption =
  | string
  | {
      /** 选项的显示文本（也是用户答时的回复内容）*/
      value: string;
      /** 优点 / 适合场景（一句话）*/
      pros?: string;
      /** 缺点 / 注意点（一句话）*/
      cons?: string;
      /** 是否推荐（true 会高亮 + 加"推荐"徽章）*/
      recommended?: boolean;
    };

export interface ClarifyRequest {
  /** 给用户的问题，例：『"销量"在你这里的口径是？』 */
  question: string;
  /**
   * 候选答案选项（2-6 个）。用户可点选，也可不选直接输入自由文本。
   * 不传则纯文本输入。
   * 推荐填对象形式 ({ value, pros, cons, recommended })，让用户能权衡。
   */
  options?: ClarifyOption[];
  /** 一句话告诉用户为什么需要澄清（非必填）*/
  reason?: string;
}

/**
 * `finalize` 返回的特殊标记：Planner 看到就停止循环
 */
export interface FinalizePayload {
  /** 最终 SQL（如果有，可空表示拒答路径）*/
  sql?: string;
  /** chart 类型 */
  chartType?: 'line' | 'bar' | 'pie' | 'table' | 'scatter' | 'heatmap' | 'auto';
  /** 给用户的自然语言总结 */
  narrative: string;
  /** 0..1 置信度 */
  confidence: number;
  /** 是否是"拒答"路径 */
  refused?: boolean;
  /** 拒答时的原因 / 需要用户补充的信息 */
  refuseReason?: string;
  /**
   * 关键歧义澄清请求。**比 refused 更精准**：
   *   refused = 我答不了（终止）
   *   clarify = 我答得了但需要你先告诉我一个关键点（暂停，等用户答完再继续）
   * 触发场景：业务术语歧义 / 时间范围缺失 / 维度选择不清 / 数据范围确认
   */
  clarify?: ClarifyRequest;
  /**
   * 主动发现的洞见（LLM 填写）：
   *   - 数据上明显的异常
   *   - 业务上值得关注的趋势
   *   - 跟用户问题相关的引申观察
   * 系统会再合并一份基于统计规则的确定性 insights
   */
  insights?: Insight[];
  /**
   * 下钻建议：3-5 个自然追问，前端会作为可点击 chip 展示
   * LLM 应该结合 Skill + 当前结果生成合理的"下一个问题"
   */
  suggestedFollowUps?: string[];
  /**
   * 主动关联提示：用户没问到、但当前数据下值得关注的"邻居"角度。
   * 跟 followUps 不同：followUps 是"自然延伸"，relatedHints 是"你没想到但 Skill 暗示该看"
   * 例：用户问"单量"时提示"准时签收率同期下降 5%，量上去时效跟着掉，建议关注"
   */
  relatedHints?: string[];
}
