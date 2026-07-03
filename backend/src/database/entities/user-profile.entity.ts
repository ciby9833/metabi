import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/**
 * Style Memory — 「怎么说话」偏好（强约束，可控）
 *
 * 这一层是用户可以明确选择的，对 LLM 的行为约束较强：
 *   - 影响语气、详略、格式
 *   - 用户能在 Settings 直接编辑
 *   - 不影响"该不该指出问题"的判断
 */
export interface StyleMemory {
  /** 详略：'concise' = 一句话；'normal' = 自然段落；'detailed' = 含统计/对比 */
  verbosity?: 'concise' | 'normal' | 'detailed';
  /** 数字格式偏好：'absolute' = 1234567；'kw' = 123 万；'auto' = LLM 自决 */
  numberFormat?: 'absolute' | 'kw' | 'auto';
  /** 主语言（zh-CN / en）— 跟用户问题语言一致时不强加 */
  preferredLanguage?: 'zh-CN' | 'en' | 'auto';
  /** 图表偏好：'auto' = LLM 自选；其他 = 倾向但不强制 */
  preferredChartType?: 'auto' | 'bar' | 'line' | 'pie' | 'table';
}

/**
 * Content Memory — 「看什么」偏好（弱约束，soft prior）
 *
 * Refiner 自动从历史对话中学习。
 * 注入 prompt 时强调"仅作上下文，不该让你回避讲他不想听的发现"。
 */
export interface ContentMemory {
  /** 关注的指标领域，如 ["应收账款","客户分级","DSO"] */
  interestTopics?: string[];
  /** 用户已熟悉的术语 — 解释时可跳过 */
  knownTerms?: string[];
  /** 高频问题模式 — 用于推荐题，不强加 */
  questionPatterns?: string[];
  /** 一句话画像：来自 Refiner LLM 的"用户长这样" */
  oneLinerSummary?: string;
  /** 用户偏好的默认时间窗口（如"最近 30 天"/"本月"）*/
  defaultDateRange?: string;
}

/**
 * UserProfile — 自动学习 + 用户可编辑的偏好（学 Claude / OpenAI Memory）
 *
 * 设计原则（Anatoli loop + anti-bias）：
 *   - **Soft prior, not hard constraint** — Planner prompt 强调这只是上下文
 *   - **透明可控** — 用户在 Settings 看见全部、可编辑、一键 reset
 *   - **分层** — Style 强约束（用户主动选）, Content 弱约束（自动学，可质疑）
 *   - **避免回声室** — Refiner 不要把"用户问过 X"硬贴成"以后默认 X"
 */
@Entity({ name: 'user_profiles', schema: 'app' })
export class UserProfile {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** 一个 user 一份 profile（DB 有 UNIQUE 约束）*/
  @Index({ unique: true })
  @Column({ type: 'uuid', name: 'user_id' })
  userId: string;

  /** Style 偏好（明确选择，强约束）*/
  @Column({ name: 'style_memory', type: 'jsonb', default: () => `'{}'` })
  styleMemory: StyleMemory;

  /** Content 偏好（Refiner 学习，弱约束）*/
  @Column({ name: 'content_memory', type: 'jsonb', default: () => `'{}'` })
  contentMemory: ContentMemory;

  /** Refiner 最近一次跑的时间 — 用来决定下次该不该跑 */
  @Column({ name: 'last_refined_at', type: 'timestamptz', nullable: true })
  lastRefinedAt: Date | null;

  /** Refiner 处理过的最大 conversation count — 决定增量起点 */
  @Column({ name: 'refined_through_conv_count', type: 'integer', default: 0 })
  refinedThroughConvCount: number;

  @Column({ name: 'created_at', type: 'timestamptz', default: () => 'CURRENT_TIMESTAMP' })
  createdAt: Date;

  @Column({ name: 'updated_at', type: 'timestamptz', default: () => 'CURRENT_TIMESTAMP' })
  updatedAt: Date;
}
