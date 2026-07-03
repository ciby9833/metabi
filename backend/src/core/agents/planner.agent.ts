import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { LLMGatewayService } from '../../providers/llm/llm-gateway.service';
import {
  AssistantToolCallMessage,
  ConversationMessage,
  LLMScenario,
  ToolDeclaration,
  ToolResultMessage,
} from '../../providers/llm/types';
import { Skill } from '../../providers/skills/types';
import { SkillRouterService } from '../../providers/skills/skill-router.service';
import { SkillLoaderService } from '../../providers/skills/skill-loader.service';
import { DatasourceMetadataService } from '../../modules/datasource/services/metadata.service';
import { TurnRecallService } from '../../modules/chat/services/turn-recall.service';
import { ReviewerAgent, ReviewOutput } from './reviewer.agent';
import { ProjectService } from '../../modules/project/services/project.service';
import { UserProfileService } from '../../modules/user-profile/services/profile.service';
import { UserContext } from '../../providers/skills/types';
import { Project, User } from '../../database/entities';
import { Conversation } from '../../database/entities';
import {
  FinalizePayload,
  ToolCallLog,
  ToolContext,
} from '../tools/tool.types';
import { ToolRegistry } from '../tools/tool-registry.service';

export interface PlannerInput {
  question: string;
  datasourceId: string;
  conversationId?: string;
  userId?: string;
  /**
   * 当作为 sub-agent 被 Master 调用时显式指定 skillName，
   * 不走 SkillRouter；并跳过 Conversation lockedSkill 复用逻辑。
   */
  forcedSkillName?: string;
  /** Master 给的子问题 — 子 agent 看到的是这个，而不是用户原问题。null 表示透传 question */
  isSubAgent?: boolean;
  /**
   * 用户上传 dataset 模式：覆盖 ToolContext.allowedTables，跳过 Skill.tables。
   * 用于自助分析场景 — Planner 仅看到指定 dataset 表，无法 SELECT 其他用户的表。
   * 完整 schema.table 路径，如 ["user_data.ds_abc123"]。
   */
  overrideAllowedTables?: string[];
  /**
   * 配合 overrideAllowedTables 用：自助数据的业务描述（dataset.description + 每列 description）
   * 注入 Planner system prompt，弥补无 Skill markdown 的业务知识缺口。
   */
  datasetContext?: string;
  /**
   * 本轮附件的 preview 文本（table 前 N 行 / pdf 前 N 字 / text 内容）
   * 放到 planner system prompt **顶部**（比 skill 更早），提高优先级 —— 附件在场时先看附件
   */
  attachmentContext?: string;
  /**
   * 本轮用户上传的 image 附件 —— 走 Anthropic vision content block
   */
  currentAttachments?: import('../../providers/llm/types').ChatAttachmentInline[];
}

export interface PlannerOutput {
  skill: Skill;
  trace: ToolCallLog[];
  finalize: FinalizePayload;
  totalTokens: number;
  totalLatencyMs: number;
  sqlResult?: {
    columns: { name: string; type: string }[];
    rows: Record<string, any>[];
    rowCount: number;
    truncated: boolean;
    executionTimeMs?: number;
    fromCache?: boolean;
    /** 工具拼的 SQL（multidim/stats 这种工具内部跑的）；finalize 用 */
    generatedSql?: string;
  };
  rawMessages: ConversationMessage[];
}

/**
 * Planner 流式事件 — 由 runStream() generator 产出。
 *
 * SSE 端点会消费这些事件并转发给前端；非流式调用方用 drainPlanner() helper。
 *
 * 关键暂停点：finalize 含 clarify 时，generator yield ClarifyRequestEvent 并**等外部 next(answer)**
 * 才会继续推进 — 这是 Claude-style 同 turn 暂停的核心。
 */
export type PlannerEvent =
  | { type: 'turn_start'; skill: { name: string; version: string } }
  | { type: 'llm_call_start'; step: number }
  | { type: 'llm_call_end'; step: number; tokens?: number }
  | { type: 'tool_executing'; step: number; toolName: string; args: any }
  | {
      type: 'tool_result';
      step: number;
      toolName: string;
      output: any;
      durationMs: number;
      error?: string;
    }
  | {
      type: 'clarify_request';
      clarify: import('../tools/tool.types').ClarifyRequest;
    }
  | { type: 'clarify_resolved'; answer: string }
  | { type: 'finalize'; finalize: FinalizePayload; sqlResult?: PlannerOutput['sqlResult'] }
  | {
      /** Verifier 完成评分（每轮 1 次）— 前端可显示 rubric 分数 */
      type: 'verifier_check';
      attempt: number;
      review: ReviewOutput;
    }
  | {
      /** Verifier 判定要返工，Planner 即将再跑一轮 */
      type: 'verifier_retry';
      attempt: number;
      reason: string;
    }
  | { type: 'error'; message: string };

const MAX_STEPS = 10;
/**
 * Verifier Gate —— **默认关**（0 = 不返工）
 *
 * 减法架构：信任 LLM 自主判断，SQL 崩了 LLM 自己看到 error 会 retry，
 * 不再由外部 rubric 强制卡关。0 保持对话/附件场景不被反复审查。
 *
 * 如果确实想开 rubric 审查（例：eval 场景），改成 2 —— 但生产默认 0。
 */
const MAX_VERIFY_RETRIES = 0;
/** 最后 N 轮按 compact summary 注入 prompt；超过的更早轮次依赖 list_previous_turns 召回 */
const RECENT_TURNS_TO_SUMMARIZE = 6;
/** 软 token 预算（按字符 ÷ 4 粗估） */
const TOKEN_BUDGET = 80_000;
const HARD_TOKEN_LIMIT = 120_000;

const PLANNER_SYSTEM_PROMPT = `你是 ChatBI 数据分析师 —— 用户的**对话式**数据分析伙伴。

## 心智模型（最重要）

你不是 SQL 执行器。你是**跟用户一起想清楚问题的分析师**。
Claude 那样的对话：**理解 → (需要时) 讨论/澄清 → (需要时) 调工具 → 回答**。

**判断标准**：
- 用户在**讨论 / 澄清 / 问概念 / 看附件 / 表达想法**（"看看这个"、"你觉得该关注啥"、"我想分析 X 好不好"）→ **直接对话回答，不要跑 SQL**
- 用户**明确要数据 / 统计 / 趋势 / 排名 / 分组**（"统计各大区订单"、"最近 7 天趋势"）→ 才调工具
- 模棱两可 → 用 clarify 反问，不要硬猜就查库

**附件优先**：如果用户本轮上传了表格/图片/文档，那**是本轮主要材料**。先基于附件回答，只有明显不够或用户要交叉库时才 SQL。**不要**看到附件转头查库。

## 工具是可选的

你有一组工具（list_tables / describe_table / run_sql / compare_periods / multidim_breakdown / stats_describe / decompose_by_dimensions / recall_turn_result / cite_industry_benchmark / finalize 等）。

**tools 是 optional**。用户问"你好"你不调 SQL；问"这份 Excel 里有啥"你不查库；问"帮我算最近 7 天订单"才调 run_sql。

真需要 SQL 时才按规矩做：
- 先 describe_table 拿字段（Skill 已给的可跳过）
- 写完整 schema 前缀（如 \`dwd.waybill_detail\` 不是 \`waybill_detail\`）
- Skill 里的术语词典（"单量 = count distinct waybill_no"）是**权威**，不要另算
- 相对时间（"最近"、"今年"）必须翻译成具体日期

## 多轮上下文

你会看到最近几轮的**SQL + 数据快照 + narrative**。用户追问"上面那个 CS 是谁"、"top 3 拆分"时：
- 引用之前的数字直接说 —— 不要再跑一次 SQL
- 需要之前具体行调 \`recall_turn_result(turn_index=N)\`

## finalize 时机

写完你的完整回答就 finalize。**两条路径都可以**：

**A. 对话路径（无 SQL）**：只有 narrative + 可选 clarify / insights / suggestedFollowUps
- 讨论 / 澄清 / 看附件 / 概念问答走这条
- sqlText 留空即可

**B. 分析路径（有 SQL）**：narrative + sqlText + resultData + chartConfig 等
- 明确的数据查询走这条

**不要跑了 SQL 就拒绝 finalize；也不要没跑 SQL 就以为不能 finalize**。看用户到底问什么。

## 澄清 (clarify) 优于硬猜

用户问题模糊时用 clarify（narrative 说"我看到几种可能" + clarify 字段带 options）：
- 术语歧义（"销量" = 运单数 / 件数 / 运费？）
- 时间不清（"最近" = 7d / 30d / 90d？）
- 维度不清（"地区" = 省 / 市 / 网点？）
- 附件是否要跟库里数据交叉（"这份 Excel 的客户在我们系统里查最近发货" 前 clarify 一次）

## 拒答 (refused) 只在

- Skills 里没这个业务领域（问财务但你只有派件）
- 时间范围完全在数据外
- 附件本身也无法回答

## 行业基准

任何"行业标准 / 通常 / 一般水平" 数字 —— 必须通过 \`cite_industry_benchmark\` 工具拿，**禁止**用训练时的常识给数字。工具返回 ok=false 时拒答 + 提示补基准。

## 语言 & insights

- narrative / insights / followUps 语言**必须**跟用户最后提问的语言一致（中问中答）
- insights **可选**：真发现异常/极值/趋势/矛盾才写；没啥好说就空
- suggestedFollowUps **可选**：有可挖的方向再写 2-3 条；没有就空
- **不要为了凑数瞎写洞见**

## ⚡ 优先：澄清 (finalize 时填 clarify 字段) 而非 refused / 而非硬猜
**关键原则：宁可问清楚也别硬猜。** 当用户问题有以下歧义时，**finalize 时填 clarify 字段**而不是 refused：

触发场景：
- **业务术语歧义**：「销量」可能是 count(distinct waybill_no) 或 sum(piece_count) 或 sum(waybill_freight)
- **时间范围缺失**：「最近」「之前」「过去一段」没指定具体范围
- **维度选择不清**：「按地区」是按 sender_province 还是 sender_city？
- **数据范围确认**：导出超 10 万行前确认
- **聚合粒度模糊**：「客户数」是按 customer_code 还是 customer_name？

调用方式（finalize 工具调用时）：
- narrative：写"我看到几种可能…"
- confidence：0.5（既不高也不拒答）
- refused: false
- **clarify**: { question: "...", options: ["...", "..."], reason: "为什么需要澄清" }
- 前端会渲染成卡片让用户选

示例：用户问"销量怎么样" → 你应该 finalize 一次澄清：
{
  narrative: "「销量」在 waybill_detail 表中有 3 种常见口径，请告诉我你想要哪一种？",
  confidence: 0.5,
  clarify: {
    question: "你说的「销量」用哪个口径？",
    options: [
      { value: "去重运单数（count distinct waybill_no）", pros: "看业务流量最准", cons: "不反映单票货值", recommended: true },
      { value: "总件数（sum piece_count）", pros: "适合衡量物流压力", cons: "一票多件会放大" },
      { value: "总运费（sum waybill_freight）", pros: "和营收口径一致", cons: "受单价波动影响" }
    ],
    reason: "不同口径相差可能 2-10 倍"
  }
}

**强烈建议**用对象形式而非纯 string，让用户能权衡 pros/cons + 看哪个是 recommended。

## 拒答 (finalize with refused=true) 的时机
**只在以下情况用 refused，其他歧义都用 clarify**：
- 用户问题用 Skill 完全覆盖不到（如问财务，但当前 Skill 只有派件）
- 走完 sample_rows 仍找不到能对应的字段（数据本身缺失）
- 用户问的时间范围**完全**在数据范围之外（数据只到 5/24 但问 6 月）

## 行业基准 / 标杆问题 ⚡ 专用工具 cite_industry_benchmark
如果用户问题包含「**行业 / 标杆 / 标准 / 通常 / 一般水平 / 业界 / benchmark / 对标**」等关键词：

**强制流程**：
1. 先调 \`cite_industry_benchmark({ metric: "派件签收率" })\` 看当前 Skill 里有没有维护对应的基准段落
2. 如果 ok=true：把基准跟内部数据**并排**展示。可以同时跑 run_sql 拿真实数据后对比；narrative 必须明示「来源：行业基准库（人工维护）」，绝不可伪装成 SQL 算出来的
3. 如果 ok=false（没有基准段落）：**拒答** + 引导用户去 Skills 后台补充基准。**严禁**用你训练时的"行业知识"凭空给数字
4. 这个工具不算 SQL 调用，Reviewer 不会因为没 run_sql 就否决你

⚠️ **核心红线**：除了通过这个工具拿到的人工维护数据，**任何**行业数字都禁止给出。

## 主动洞见 + 下钻建议（finalize 必填）
**这是你的核心价值**：不只回答字面问题，还要主动发现 + 引导继续挖。
finalize 时**必须**填两个字段：
- \`insights\`：你发现的有意思的点（1-3 条）
  * 数据异常：某个数值远高于/低于其他
  * 集中度：Top 1 占比异常高
  * 趋势：连续上升/下降
  * 业务可疑：跟 Skill 描述的常态不一致
  * 没什么特别可说时可以省略，不要为了凑数瞎写
- \`suggestedFollowUps\`：3-5 个下钻建议（每条是完整中文问题）
  * 基于结果中"值得继续挖"的点设计
  * 倾向选 Skill 里 attributableDimensions 标注的维度
  * 例："Top 1 站点为什么这么高？"、"按时段拆看分布"、"那这个站点的人均派件量是多少？"

## 同比 / 环比 / 对比模式 ⚡ 使用专用工具
如果当前问题包含「**同比 / 环比 / 上周 / 上月 / 上季度 / 上年 / 去年 / 相比 / 对比 / 比上**」等关键词：

**强制流程**：
1. 直接调用 \`compare_periods\` 工具，传入：
   - \`metric_expression\`: 指标聚合表达式
   - \`table\`: 表名
   - \`current_period_where\` + \`previous_period_where\`: 两个时间窗口的 WHERE
   - \`time_dimension\`: 可选时间分组维度（按天对比 / 按月对比时填）
   - \`current_label\` + \`previous_label\`: 中文标签（"本周"/"上周"）
2. 工具一次性返回总变化 + 每个时间点的对比 + 推荐图表类型
3. **finalize 时**：narrative 用 summary 字段；chartType 用 suggestedChart 返回值；把"增长最多的点 / 下降最多的点"作为 insights[kind=trend]

## 多维分布 / 占比 / 流向 → ⚡ 首选 multidim_breakdown 工具
如果当前问题是**横向看分布、占比、流向、各 X 多少**这类**多维聚合**：
- 「流向：寄件城市 → 收件城市 的单量、占比、公斤段」
- 「各区域、各客户、各产品 的单量、收入、占比」
- 「按时段 × 网点 看签收时效分布」
- 「TopN 客户 + 他们的品类构成」

**首选 multidim_breakdown**：工具内部统一拼 CTE，保证占比分子分母同源、自动 NULLIF 防 0 除、自动过滤 NULL 维度行。

示例（伪代码格式，记得严格按 JSON 调）：
- 流向 + 公斤段：调 multidim_breakdown，groupBy=["origin_city","destination_city"]，bucketBy={field:"billing_weight",type:"numeric",buckets:[{label:"0-1kg",max:1},{label:"1-3kg",min:1,max:3}]}，metrics=[{name:"order_count",kind:"count_distinct",column:"waybill_no"}]，includePctOfTotal=true，windowDays=30，topN=20
- TopN 客户 + 各品类：groupBy=["customer_name"]，bucketBy={field:"goods_category",type:"enum",buckets:["服装","食品","电器"]}，metrics=[{name:"orders",kind:"count_distinct",column:"waybill_no"}]，includePctOfTotal=true，topN=10

**仅当**问题超出工具能力（含 JOIN 多表、复杂自定义窗口、动态时间桶 PIVOT）才回退到 run_sql。

**不要**用 decompose_by_dimensions（那个工具是给"找哪个维度是异常主因"用的，不适合横向交叉表）。

## 描述统计 / 百分位 / 分布摘要 → ⚡ 首选 stats_describe 工具
如果用户问的是 **某个数值字段的统计摘要**（avg / median / p50 / p90 / p99 / stddev / min / max）：
- 「派送时长的 p50、p90、p99 是多少」
- 「各网点的平均运费 + 中位数」
- 「客单价的分布摘要」

**首选 stats_describe**：自动用 PG 正确的 percentile_cont 语法，自动算 null 比例。比自己写 SQL 不容易出语法错。

## 单维归因模式（用户问"为什么 X 高了/低了"时）⚡ 使用 decompose_by_dimensions
**仅当**用户问题包含「**为什么 / 为何 / 归因 / 原因 / 主因 / 拉动 / 涨 / 跌 / 是什么导致**」等**因果**关键词，且**有两个时间点要对比**时使用：

**强制流程**：
1. 用 list_previous_turns 或 recall_turn_result 确认被询问的具体指标/时间点
2. **直接调用 \`decompose_by_dimensions\` 工具**，传入：
   - \`metric_expression\`: 指标聚合表达式（如 \`COUNT(DISTINCT waybill_no)\`）
   - \`table\`: 完整表名
   - \`dimensions\`: 用 Skill 中 attributableDimensions 列出的字段（**全部传过去**）
   - \`current_period_where\`: 当前期 WHERE（如 \`source_date = '2026-05-23'\`）
   - \`baseline_period_where\`: 对照期 WHERE（如 \`source_date BETWEEN '2026-05-17' AND '2026-05-22'\`）
3. 工具会自动算各维度贡献度并返回结构化结果
4. **finalize 时**：把 \`decompose_by_dimensions\` 返回的 summary 作为 narrative 的核心，并在 \`insights\` 数组里**每个最大贡献维度都加一条 kind=attribution 的洞见**

⚠️ **不要**：
- 不要自己手写一堆分组 SQL（用 decompose_by_dimensions 一次搞定）
- 不要省略基线期（除非用户只问"X 占比怎样"而不是"X 为什么这样"）
`;

/**
 * PlannerAgent v3
 *
 * 关键变化：
 *  1. Skill 会话级锁定（第 1 轮 route，后续读 Conversation.lockedSkillName）
 *  2. 历史以紧凑摘要注入 system 块（带 SQL + 前 3 行真实数据快照）
 *  3. 完整 transcript 不回放，需要时通过 3 个 recall tools 按需召回
 *  4. token 预算守护：超 80k 砍最早轮次的数据快照
 */
@Injectable()
export class PlannerAgent {
  private readonly logger = new Logger(PlannerAgent.name);

  constructor(
    private readonly llm: LLMGatewayService,
    private readonly skillRouter: SkillRouterService,
    private readonly skillLoader: SkillLoaderService,
    private readonly toolRegistry: ToolRegistry,
    private readonly metadata: DatasourceMetadataService,
    private readonly recall: TurnRecallService,
    private readonly reviewer: ReviewerAgent,
    private readonly projectService: ProjectService,
    private readonly userProfile: UserProfileService,
    @InjectRepository(Conversation)
    private readonly conversationRepo: Repository<Conversation>,
    @InjectRepository(Project)
    private readonly projectRepo: Repository<Project>,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
  ) {}

  /**
   * 主入口 — async generator。每个 step yield 事件；clarify 时 yield 后**等外部 next(answer)** 续推。
   *
   * 用法：
   *   - SSE 端点：消费每个 event 推给前端；遇 clarify_request → 收到用户答 → gen.next(answer)
   *   - 非 SSE：用 drainPlanner() helper drain 到结束（sub-agent 路径 clarify 被禁，理论不触发）
   *
   * Generator 第三个泛型 `string | undefined` 是 yield 时外部 next(answer) 传入的值；
   * 仅在 yield ClarifyRequestEvent 时使用。
   */
  async *runStream(
    input: PlannerInput,
  ): AsyncGenerator<PlannerEvent, PlannerOutput, string | undefined> {
    const startedAt = Date.now();

    // 🔑 dataset 模式（用户自助分析）：跳过企业 skill 路由 + 企业元数据，
    //   完全用 ProjectSkill 装配的 datasetContext 作为唯一上下文。
    const isDatasetMode =
      !!input.overrideAllowedTables && input.overrideAllowedTables.length > 0;

    // 1) Skill 装配（减法架构）：
    //   - dataset 模式 → 虚拟 ProjectSkill（用户自助上下文）
    //   - Master 强制指定（子 agent）→ 单 skill 兜底
    //   - conversation.lockedSkillName → 单 skill（历史锁定，保留）
    //   - 其他 → 全部可见 skills 塞 system，LLM 自选
    let skills: Skill[];
    let primarySkill: Skill;
    if (isDatasetMode) {
      const virtual = this.buildVirtualProjectSkill(input);
      skills = [virtual];
      primarySkill = virtual;
    } else if (input.forcedSkillName || input.isSubAgent) {
      const single = await this.resolveSkill(input);
      skills = [single];
      primarySkill = single;
    } else {
      skills = await this.resolveVisibleSkills(input);
      // 兜底：如果 user 没任何可见 skill，用 fallback
      if (skills.length === 0) {
        const fb = await this.resolveSkill(input);
        skills = [fb];
        primarySkill = fb;
      } else {
        primarySkill = skills[0]; // priority 最高作为展示 skill
      }
    }
    yield { type: 'turn_start', skill: { name: primarySkill.meta.name, version: primarySkill.meta.version } };

    // allowedTables：多 skills 时用并集，缩小到 LLM 能选的表；dataset 模式仍用 override
    const skillTablesUnion = isDatasetMode
      ? input.overrideAllowedTables!
      : Array.from(new Set(skills.flatMap((s) => s.meta.tables || [])));

    const ctx: ToolContext = {
      datasourceId: input.datasourceId,
      conversationId: input.conversationId,
      userId: input.userId,
      log: [],
      sqlCallCount: 0,
      successfulSqlRuns: 0,
      allowedTables: skillTablesUnion,
      // ctx.skill 仍用 primary（工具层的一些日志/审计走这个）
      skill: {
        name: primarySkill.meta.name,
        version: primarySkill.meta.version,
        body: primarySkill.body,
      },
    };

    // 工具集按 metadata 过滤（context-aligned 设计）：
    // 每个工具声明 availability，未声明默认 'both'。Planner 不 hardcode 工具名 —
    // 加新工具（如 Connectors export_excel）只需在工具自身打标签，此处自动适配。
    const allTools = this.toolRegistry.getAll();
    const tools = allTools.filter((t) => {
      const availability = t.definition.availability ?? 'both';
      if (availability === 'both') return true;
      return isDatasetMode
        ? availability === 'dataset_only'
        : availability === 'enterprise_only';
    });
    const toolDeclarations: ToolDeclaration[] = tools.map((t) => t.definition);

    // 2) 元数据：企业模式注入 datasource 元数据；dataset 模式跳过（避免污染）
    const metaContext = isDatasetMode
      ? null
      : await this.buildMetadataContext(input.datasourceId);

    // 3) 历史轮次摘要
    const historyContext = await this.buildHistoryContext(input.conversationId);

    // 4) Project 级 systemInstructions（dataset 模式下也保留 — 用户写的项目说明）
    const projectInstructions = await this.buildProjectInstructions(input.conversationId);

    // 5) User identity 软引导（dept/role）— 仅当用户填了 Settings 时有效
    const userCtx = await this.buildUserContext(input.userId);
    const userIdentityPrompt = this.buildUserIdentityPrompt(userCtx);

    // 6) User Profile（Memory）— 拆成 Style + Content 两段
    //    - Style 永远注入（跟话题无关：详略/格式/图表）
    //    - Content 有话题切换检测：若本次 question 跟 profile 关注不重合 → 挂起
    //      （anti-bias 关键机制 — 避免财务用户切到销售话题时被"财务分析师"画像误导）
    let userStylePrompt: string | null = null;
    let userContentPrompt: string | null = null;
    if (input.userId) {
      const profile = await this.userProfile.getOrEmpty(input.userId);
      userStylePrompt = this.userProfile.buildStyleInjection(profile);
      const check = this.userProfile.detectTopicMismatch(profile, input.question);
      if (check.mismatch) {
        this.logger.log(`[topic-switch] user=${input.userId}: ${check.reason}`);
        userContentPrompt = null; // 挂起
      } else {
        userContentPrompt = this.userProfile.buildContentInjection(profile);
      }
    }

    // 本轮附件（image）加到最后一条 user 消息 —— Anthropic vision 走 content block
    const userMessage: ConversationMessage = {
      role: 'user',
      content: this.buildUserQuestionContext(input.question),
      ...(input.currentAttachments && input.currentAttachments.length > 0
        ? { attachments: input.currentAttachments }
        : {}),
    };

    // 附件顶部 — 在 skill / metadata 之前，让 LLM 第一眼看到"用户本轮传了啥"
    const attachmentHeader = input.attachmentContext
      ? [{ role: 'system' as const, content: input.attachmentContext }]
      : [];

    const messages: ConversationMessage[] = isDatasetMode
      ? [
          ...attachmentHeader,
          { role: 'system', content: PLANNER_SYSTEM_PROMPT },
          { role: 'system', content: this.buildTimeContext() },
          { role: 'system', content: input.datasetContext! },
          ...(userIdentityPrompt ? [{ role: 'system' as const, content: userIdentityPrompt }] : []),
          ...(userStylePrompt ? [{ role: 'system' as const, content: userStylePrompt }] : []),
          ...(userContentPrompt ? [{ role: 'system' as const, content: userContentPrompt }] : []),
          ...(projectInstructions ? [{ role: 'system' as const, content: projectInstructions }] : []),
          ...(historyContext ? [{ role: 'system' as const, content: historyContext }] : []),
          userMessage,
        ]
      : [
          ...attachmentHeader,
          { role: 'system', content: PLANNER_SYSTEM_PROMPT },
          { role: 'system', content: this.buildTimeContext() },
          { role: 'system', content: this.buildSkillsListContext(skills) },
          ...(userIdentityPrompt ? [{ role: 'system' as const, content: userIdentityPrompt }] : []),
          ...(userStylePrompt ? [{ role: 'system' as const, content: userStylePrompt }] : []),
          ...(userContentPrompt ? [{ role: 'system' as const, content: userContentPrompt }] : []),
          ...(projectInstructions ? [{ role: 'system' as const, content: projectInstructions }] : []),
          ...(metaContext ? [{ role: 'system' as const, content: metaContext }] : []),
          ...(historyContext ? [{ role: 'system' as const, content: historyContext }] : []),
          userMessage,
        ];

    let totalTokens = 0;
    let finalize: FinalizePayload | undefined;
    let lastSqlResult: PlannerOutput['sqlResult'];
    /** 所有真跑过 SQL 的快照（按时间序）。finalize 时按 finalize.sql 反查最匹配的 */
    const sqlResultsHistory: NonNullable<PlannerOutput['sqlResult']>[] = [];
    let nudgedToFinalize = false;
    /**
     * Verifier Gate state — Anatoli 的 "the gate that decides whether the loop helps or just spends money"
     * Sub-agent 路径跳过 verify（被 Master 调用，由 Master 层验收）
     */
    const verifyEnabled = !input.isSubAgent && MAX_VERIFY_RETRIES > 0;
    let verifyAttempt = 0;
    let lastReview: ReviewOutput | undefined;

    // ====== ReAct loop ======
    // 用 while + step++ 而不是 for，因为 clarify 续推时需要"重置" step 计数
    // 但智能侧：clarify 只发生在 finalize 时，所以 step 计数继续往前不会有问题
    let step = 0;
    outerLoop: while (step < MAX_STEPS) {
      step++;
      this.logger.debug(`[step ${step}] Calling LLM with ${tools.length} tools`);
      yield { type: 'llm_call_start', step };

      const resp = await this.llm.callWithTools(messages, toolDeclarations, {
        scenario: LLMScenario.SQL_GENERATION,
        temperature: 0.1,
      });
      const stepTokens = resp.usage?.totalTokens || 0;
      totalTokens += stepTokens;
      yield { type: 'llm_call_end', step, tokens: stepTokens };

      if (resp.type === 'message') {
        this.logger.warn(`Step ${step}: LLM returned plain text without finalize. Forcing refuse.`);
        finalize = {
          narrative: resp.content || '抱歉，我没能完成这次分析。',
          confidence: 0.2,
          refused: true,
          refuseReason: 'LLM 未调用 finalize 工具就直接结束了。',
        };
        break;
      }

      const toolCalls = resp.toolCalls || [];
      const assistantMsg: AssistantToolCallMessage = {
        role: 'assistant',
        toolCalls,
        content: resp.content,
      };
      messages.push(assistantMsg);

      const finalizeCall = toolCalls.find((tc) => this.toolRegistry.isFinalize(tc.name));
      if (finalizeCall) {
        const candidateFinalize = finalizeCall.arguments as FinalizePayload;
        ctx.log.push({
          step,
          name: 'finalize',
          input: finalizeCall.arguments,
          output: candidateFinalize,
          durationMs: 0,
          timestamp: new Date().toISOString(),
        });
        this.logger.log(
          `Step ${step}: finalize received (refused=${candidateFinalize.refused}, hasClarify=${!!candidateFinalize.clarify})`,
        );

        // ===== Dataset 模式硬拦截 clarify =====
        // 用户上传自己的数据，他比 AI 更清楚口径；clarify 是低效行为。
        // prompt 已强禁，仍然 clarify 时直接注入指令让 LLM 重做（不暂停等用户答）
        if (isDatasetMode && candidateFinalize.clarify?.question) {
          this.logger.warn(`Step ${step}: dataset mode rejected clarify, forcing re-run`);
          messages.push(
            this.toolResultMessage(finalizeCall.id, finalizeCall.name, {
              ok: false,
              clarifyRejected: true,
              clarifyAttempt: candidateFinalize.clarify.question,
              instruction:
                'Dataset 模式严禁 clarify。用户上传的是他自己的数据，所有问题按系统提示中默认口径直接算。' +
                '立即用 run_sql 算出数字，然后 finalize（不要 clarify）。',
            }),
          );
          continue outerLoop;
        }

        // ===== 关键：clarify 暂停 + 续推 =====
        // sub-agent 路径下 prompt 已禁止 clarify；这里仍然防御性处理
        if (candidateFinalize.clarify?.question && !input.isSubAgent) {
          const answerFromUser = yield {
            type: 'clarify_request',
            clarify: candidateFinalize.clarify,
          };

          if (typeof answerFromUser === 'string' && answerFromUser.trim()) {
            // 用户答了 → 把答案合并进 messages，模拟"补充信息后继续"
            const mergedHint =
              `（你上一轮 finalize 提出了 clarify："${candidateFinalize.clarify.question}"；` +
              `用户的回答是："${answerFromUser.trim()}"。请基于此**立即**执行最合理的查询并给出数据，不要再 clarify。）`;
            messages.push({ role: 'user', content: mergedHint });
            yield { type: 'clarify_resolved', answer: answerFromUser.trim() };
            // 不 break — 继续 ReAct loop 让 LLM 基于新信息继续
            continue outerLoop;
          }
          // 没收到答案（外部 drain 模式或 abort）→ fallback：当作普通 finalize
        }

        // ===== Verifier Gate（核心）=====
        // 不返工的场景：sub-agent / 拒答路径 / 关闭 verify
        const skipVerify =
          !verifyEnabled ||
          candidateFinalize.refused ||
          !!candidateFinalize.clarify?.question;

        if (skipVerify) {
          finalize = candidateFinalize;
          break;
        }

        const review = await this.runVerify(
          input.question,
          primarySkill,
          ctx.log,
          candidateFinalize,
          sqlResultsHistory[sqlResultsHistory.length - 1],
          verifyAttempt,
        );
        lastReview = review;
        yield { type: 'verifier_check', attempt: verifyAttempt + 1, review };

        // 通过 → 真 finalize 退出
        if (!review.shouldRetry) {
          // 把 verifier 的 confidence 写回 finalize（替代 Planner 自评）
          candidateFinalize.confidence = review.confidence;
          if (review.shouldRefuse) {
            candidateFinalize.refused = true;
            candidateFinalize.refuseReason =
              candidateFinalize.refuseReason ||
              (review.concerns.length > 0
                ? review.concerns.join('；')
                : `Verifier 总分 ${(review.confidence * 10).toFixed(1)}/10，未达可信阈值`);
          }
          finalize = candidateFinalize;
          break;
        }

        // 不达标 → 注入反馈让 Planner 再来一轮
        verifyAttempt++;
        yield {
          type: 'verifier_retry',
          attempt: verifyAttempt,
          reason: review.feedback || review.summary,
        };
        // 把 finalize 工具调用结果换成 Verifier 反馈 — LLM 看到自己被驳回 + 改进方向
        messages.push(
          this.toolResultMessage(finalizeCall.id, finalizeCall.name, {
            ok: false,
            verifierRejected: true,
            scores: review.dimensions,
            feedback: review.feedback,
            instruction:
              '上面是 Verifier 对你 finalize 的评分。请按 feedback 修正：' +
              '查正确的 SQL（或补 JOIN），然后再次 finalize。' +
              `本次是第 ${verifyAttempt} 次返工，最多 ${MAX_VERIFY_RETRIES} 次。`,
          }),
        );
        continue outerLoop;
      }

      for (const tc of toolCalls) {
        const tool = this.toolRegistry.getByName(tc.name);
        if (!tool) {
          this.logger.warn(`Step ${step}: Unknown tool '${tc.name}'`);
          messages.push(this.toolResultMessage(tc.id, tc.name, {
            error: `unknown tool: ${tc.name}`,
          }));
          continue;
        }
        yield { type: 'tool_executing', step, toolName: tc.name, args: tc.arguments };
        const t0 = Date.now();
        let output: any;
        let error: string | undefined;
        try {
          output = await tool.execute(tc.arguments, ctx);
          // 记录"最后一次成功跑出真实数据的工具调用"
          // 不止 run_sql：multidim_breakdown / stats_describe / decompose_by_dimensions /
          // compare_periods / cohort_retention / funnel_conversion / forecast 这些工具
          // 内部都执行了真 SQL 并返回 columns + rows，需要它们的数据流到 finalize
          const isDataTool =
            (tc.name === 'run_sql' && !output?.dryRun) ||
            tc.name === 'multidim_breakdown' ||
            tc.name === 'stats_describe' ||
            tc.name === 'decompose_by_dimensions' ||
            tc.name === 'compare_periods' ||
            tc.name === 'cohort_retention' ||
            tc.name === 'funnel_conversion' ||
            tc.name === 'forecast';
          if (isDataTool && output?.ok && Array.isArray(output?.columns)) {
            // run_sql 工具调用时 SQL 在 tc.arguments.sql；其他工具用工具自己的 generatedSql
            const sqlOfThisCall =
              (tc.arguments as any)?.sql || output.generatedSql || output.sql;
            const snap: NonNullable<PlannerOutput['sqlResult']> = {
              columns: output.columns,
              rows: output.rows || [],
              rowCount: output.rowCount ?? (output.rows?.length || 0),
              truncated: output.truncated || false,
              executionTimeMs: output.executionTimeMs,
              fromCache: output.fromCache,
              generatedSql: sqlOfThisCall,
            };
            sqlResultsHistory.push(snap);
            lastSqlResult = snap;
          }
        } catch (err) {
          error = (err as Error).message;
          output = { error };
        }
        const durationMs = Date.now() - t0;
        ctx.log.push({
          step,
          name: tc.name,
          input: tc.arguments,
          output: this.summarizeForLog(tc.name, output),
          durationMs,
          error,
          timestamp: new Date().toISOString(),
        });

        yield {
          type: 'tool_result',
          step,
          toolName: tc.name,
          output: this.summarizeForLog(tc.name, output),
          durationMs,
          error,
        };

        messages.push(this.toolResultMessage(tc.id, tc.name, this.summarizeForLLM(tc.name, output)));
      }

      if (lastSqlResult && !nudgedToFinalize) {
        nudgedToFinalize = true;
        messages.push({
          role: 'system',
          content:
            '✅ 你已经成功执行 SQL 并拿到了有效结果。除非这个结果明显有问题（违反 Skill 业务定义），' +
            '否则**立刻调用 finalize 工具结束循环**。Verifier 会评估你的结果，不通过会让你修改。',
        });
      }

      // ===== Cycle detection — Anatoli 的 "loop with no exit drains your account" =====
      // 连续 2 步调相同 tool + 相同 args 视为陷入 cycle，强制 LLM finalize 退出
      if (this.detectCycle(ctx.log)) {
        this.logger.warn(`Step ${step}: Cycle detected (repeated tool+args); forcing finalize.`);
        messages.push({
          role: 'system',
          content:
            '⚠️ 检测到你连续重复了同一工具调用。这通常意味着你卡住了或在试图回避正面回答。' +
            '请**立刻调用 finalize**：基于当前已有信息给出最佳答案；' +
            '如果数据真的不足，finalize 时设 refused=true 并说明原因。',
        });
      }
    }

    if (!finalize) {
      this.logger.warn(`Reached MAX_STEPS=${MAX_STEPS} without finalize. Forcing refuse.`);
      const reason = lastReview
        ? `达到最大步数 ${MAX_STEPS}；Verifier 上一轮反馈：${lastReview.feedback || lastReview.summary || '未达标'}`
        : `达到最大步数 ${MAX_STEPS} 仍未完成。`;
      finalize = {
        narrative: '抱歉，多轮探索后我仍未能得出可信答案。',
        confidence: 0.1,
        refused: true,
        refuseReason: reason,
      };
    }

    // 按 finalize.sql 反查最匹配的历史 SQL 结果
    // 修复了"LLM finalize 用了第一个 SQL 但 lastSqlResult 是最后一个"的老问题
    const finalSqlText = (finalize.sql || '').trim();
    let resolvedSqlResult = lastSqlResult;
    if (finalSqlText && sqlResultsHistory.length > 0) {
      const normalize = (s: string) => s.replace(/\s+/g, ' ').trim().toLowerCase();
      const target = normalize(finalSqlText);
      const matched = sqlResultsHistory.find(
        (h) => h.generatedSql && normalize(h.generatedSql) === target,
      );
      if (matched) resolvedSqlResult = matched;
    }

    const output: PlannerOutput = {
      skill: primarySkill,
      trace: ctx.log,
      finalize,
      totalTokens,
      totalLatencyMs: Date.now() - startedAt,
      sqlResult: resolvedSqlResult,
      rawMessages: messages,
    };

    yield { type: 'finalize', finalize, sqlResult: resolvedSqlResult };

    return output;
  }

  // ===================== Skill 选择 =====================

  /**
   * Dataset 模式专用：构造虚拟 ProjectSkill。
   *
   * 不从 Skill 库选 — 因为：
   *   1. 企业 Skill 含特定业务领域知识，会污染用户自助分析
   *   2. 企业 Skill 的 metadata（dws.* / ods.* 表）会被注入 system，浪费 token + 误导 LLM
   *
   * 这个虚拟 skill 的 body 是空的（实际 prompt 在 datasetContext 字段里，
   * 由 ProjectSkillAssembler 装配），只占 turn_start 事件展示用。
   */
  /**
   * Cycle detection：判断最近 2 次工具调用是否「同 tool 名 + 同 args」。
   * 防御 "Ralph Wiggum loop"（agent 在原地打转烧 token）。
   */
  private detectCycle(log: ToolCallLog[]): boolean {
    if (log.length < 2) return false;
    const last = log[log.length - 1];
    const prev = log[log.length - 2];
    if (last.name !== prev.name) return false;
    if (last.name === 'finalize') return false; // finalize 不算 cycle
    try {
      return JSON.stringify(last.input) === JSON.stringify(prev.input);
    } catch {
      return false;
    }
  }

  /**
   * 调 Reviewer 评估 finalize 候选。
   * 单点封装：未来 verify 改成并行/缓存/换 cheaper model 都只动这里。
   */
  private async runVerify(
    question: string,
    skill: Skill,
    trace: ToolCallLog[],
    candidate: FinalizePayload,
    latestSql: PlannerOutput['sqlResult'] | undefined,
    attemptIndex: number,
  ): Promise<ReviewOutput> {
    return this.reviewer.review({
      question,
      skill,
      trace,
      proposed: candidate,
      sqlResult: latestSql
        ? {
            rowCount: latestSql.rowCount,
            columns: latestSql.columns,
            rows: latestSql.rows,
          }
        : undefined,
      attemptIndex,
      maxAttempts: MAX_VERIFY_RETRIES,
    });
  }

  private buildVirtualProjectSkill(input: PlannerInput): Skill {
    return {
      meta: {
        name: 'project-knowledge',
        version: '1.0.0',
        description: '用户上传数据的自助分析（动态装配）',
        tables: input.overrideAllowedTables || [],
      },
      body: '',
      filePath: '<virtual:project-skill>',
    };
  }

  private async resolveSkill(input: PlannerInput): Promise<Skill> {
    // Master 显式指定 → 直接用，不走 router 不读 lockedSkillName
    if (input.forcedSkillName) {
      const forced = this.skillLoader.getByName(input.forcedSkillName);
      if (forced) {
        this.logger.log(`SubAgent forced skill: ${forced.meta.name}`);
        return forced;
      }
      this.logger.warn(
        `Forced skill '${input.forcedSkillName}' not found; fall back to routing`,
      );
    }
    if (input.conversationId && !input.isSubAgent) {
      const conv = await this.conversationRepo.findOne({
        where: { id: input.conversationId },
      });
      if (conv?.lockedSkillName) {
        const locked = this.skillLoader.getByName(conv.lockedSkillName);
        if (locked) {
          this.logger.log(`Using locked skill from conversation: ${locked.meta.name}`);
          return locked;
        }
        this.logger.warn(
          `Locked skill '${conv.lockedSkillName}' not found in loader; re-routing`,
        );
      }
    }
    // 按 user 可见性过滤后路由
    const userCtx = await this.buildUserContext(input.userId);
    const { selected } = this.skillRouter.route(input.question, userCtx);
    return selected;
  }

  /**
   * 构建当前 user 的上下文：含可访问的 projects、部门、角色。
   * 用于：① Skill visibility 过滤；② Planner system prompt 软引导。
   */
  private async buildUserContext(userId?: string): Promise<UserContext> {
    if (!userId) return {};
    try {
      const user = await this.userRepo.findOne({ where: { id: userId } });
      if (!user) return { userId };
      const projects = await this.projectService.listForUser(userId);
      return {
        userId,
        accessibleProjectIds: projects.map((p) => p.id),
        department: user.department || null,
        jobRole: user.jobRole || null,
        displayName: user.name || user.email,
      };
    } catch (err) {
      this.logger.warn(`buildUserContext failed: ${(err as Error).message}`);
      return { userId };
    }
  }

  /** 把 user 身份拼成一段软引导 prompt（context-align: 让 LLM 知道服务对象，不强制行为）*/
  private buildUserIdentityPrompt(user: UserContext): string | null {
    if (!user.userId) return null;
    const parts: string[] = [];
    if (user.displayName) parts.push(`姓名 ${user.displayName}`);
    if (user.department) parts.push(`部门 ${user.department}`);
    if (user.jobRole) parts.push(`角色 ${user.jobRole}`);
    if (parts.length === 0) return null;
    return [
      '# 👤 当前服务对象',
      `你正在为 **${parts.join(' / ')}** 服务。`,
      '',
      '这是软上下文 — 让你了解服务对象，但**不应改变你的分析方法或结论**：',
      '- 数据和结论以事实为准，不因角色定制偏好',
      '- 术语可以贴合对方常用词（如对财务用户用"账期/DSO"，对销售用户用"成单/客户"）',
      '- 不要主动添加"作为 X 部门" 这种话；行为要专业、自然',
    ].join('\n');
  }

  // ===================== Context Builders =====================

  /**
   * 时间感知 — 让 LLM 知道"今天"是哪天，避免把"6 月"猜成 2025。
   * 同时提示数据通常 T-1 / T-2 才完整，避免用户问"今天"时硬查当天导致空表。
   */
  private buildTimeContext(): string {
    const now = new Date();
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
    const fmt = (d: Date) => d.toISOString().substring(0, 10);
    const today = fmt(now);
    const yesterday = fmt(new Date(now.getTime() - 86400000));
    const d7 = fmt(new Date(now.getTime() - 7 * 86400000));
    const d30 = fmt(new Date(now.getTime() - 30 * 86400000));
    const thisMonthStart = `${today.substring(0, 7)}-01`;
    // 上月第 1 天 / 末 1 天
    const firstOfThisMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const lastMonthEnd = new Date(firstOfThisMonth.getTime() - 86400000);
    const lastMonthStart = new Date(lastMonthEnd.getFullYear(), lastMonthEnd.getMonth(), 1);
    return [
      `# ⏰ 时间上下文（务必参考）`,
      `今天: **${today}** (${['周日','周一','周二','周三','周四','周五','周六'][now.getDay()]}, 时区 ${tz})`,
      `昨天: ${yesterday}`,
      `最近 7 天: ${d7} ~ ${today}`,
      `最近 30 天: ${d30} ~ ${today}`,
      `本月: ${thisMonthStart} ~ ${today}`,
      `上月: ${fmt(lastMonthStart)} ~ ${fmt(lastMonthEnd)}`,
      ``,
      `重要：`,
      `- 用户说"今年/今月/最近/上月/上周"等相对时间，**必须**翻译成具体日期范围再写 SQL`,
      `- 数据通常有 **T-1（昨天）才完整**：用户问"今天"，应主动改用昨天的数据，并在 narrative 里说明`,
      `- 别凭空假设其他年份（如把"6 月"猜成 2025-06），就用当前年份`,
    ].join('\n');
  }

  private buildSkillContext(skill: Skill): string {
    const dims = skill.meta.attributableDimensions || [];
    const attributableBlock =
      dims.length > 0
        ? `\n\n## 本 Skill 的可归因维度（用户问"为什么/差异/归因"时按这些拆分）\n${dims.map((d) => `- \`${d}\``).join('\n')}`
        : '';
    return `# 你将使用以下 Skill 处理本次问题

Skill 名称：${skill.meta.name} (v${skill.meta.version})
描述：${skill.meta.description}

---
${skill.body}
---
${attributableBlock}

请严格遵循上述 Skill 的工作流、字段语义、业务术语词典和图表推荐。`;
  }

  /**
   * 多 Skill 上下文 —— "减法架构"关键
   *
   * 不再让 router 提前选定 1 个 skill，而是把用户所有**可见** skills 的元信息 + body 都塞给 LLM，
   * 让它自己判断该用哪个（或都不用，走对话路径）。
   *
   * 顺序：按 priority 降序；每个 skill 完整 body（业务知识不裁剪）
   */
  private buildSkillsListContext(skills: Skill[]): string {
    if (skills.length === 0) {
      return '# 可用业务知识\n\n（无 Skill 匹配当前用户可见性，纯粹按你的通用能力回答）';
    }
    const parts: string[] = [
      '# 可用业务知识（Skills）',
      '',
      '下面列出你**可以选用**的业务 Skills。选择规则：',
      '- 用户问题清晰对应某个 Skill 的业务领域 → 用它的 body 引导 SQL / 术语',
      '- 用户在**讨论 / 澄清 / 概念性提问 / 看附件** → 无需选 Skill，直接对话',
      '- 用户问题**跨多个 Skill** → 用最相关的那个作主线，参考其他',
      '',
      '---',
      '',
    ];
    for (const skill of skills) {
      const dims = skill.meta.attributableDimensions || [];
      parts.push(`## Skill: \`${skill.meta.name}\` (v${skill.meta.version})`);
      parts.push(`_${skill.meta.description}_`);
      if (skill.meta.match) parts.push(`_匹配关键词_: ${skill.meta.match}`);
      if (dims.length > 0) parts.push(`_可归因维度_: ${dims.map((d) => `\`${d}\``).join(', ')}`);
      parts.push('');
      parts.push(skill.body);
      parts.push('');
      parts.push('---');
      parts.push('');
    }
    return parts.join('\n');
  }

  /**
   * 列出用户可见的所有 skills（不再"选一个"—— skill 选择交给 LLM）
   */
  private async resolveVisibleSkills(input: PlannerInput): Promise<Skill[]> {
    const userCtx = await this.buildUserContext(input.userId);
    const all = this.skillLoader.getAll();
    const visible = all.filter((s) =>
      require('../../providers/skills/types').isSkillVisibleToUser(s, userCtx),
    );
    // 按 priority 降序
    visible.sort((a, b) => (b.meta.priority || 0) - (a.meta.priority || 0));
    return visible;
  }

  /**
   * Project 级 systemInstructions — 跨对话共享的"任务背景"。
   * 比 Skill 更高一层：Skill 是业务领域知识，Project 指令是当前分析任务的上下文。
   */
  private async buildProjectInstructions(conversationId?: string): Promise<string | null> {
    if (!conversationId) return null;
    const conv = await this.conversationRepo.findOne({ where: { id: conversationId } });
    if (!conv?.projectId) return null;
    const project = await this.projectRepo.findOne({ where: { id: conv.projectId } });
    if (!project?.systemInstructions?.trim()) return null;
    return [
      `# 项目上下文：「${project.name}」`,
      project.description ? `_项目说明：${project.description}_` : '',
      '',
      '## 项目级指令（最高优先级，所有回答都要遵循）',
      project.systemInstructions.trim(),
    ]
      .filter(Boolean)
      .join('\n');
  }

  /**
   * 数据源元数据上下文（业务管理员在前端 UI 配置的）
   */
  private async buildMetadataContext(datasourceId: string): Promise<string | null> {
    const [tablesMeta, glossary, questions] = await Promise.all([
      this.metadata.getAllForDatasource(datasourceId),
      this.metadata.listGlossary(datasourceId),
      this.metadata.listQuestions(datasourceId),
    ]);

    if (tablesMeta.length === 0 && glossary.length === 0 && questions.length === 0) {
      return null;
    }

    const lines: string[] = ['# 数据源补充元数据（由数据治理人员维护）'];

    if (tablesMeta.length > 0) {
      lines.push('\n## 表 / 字段说明');
      const tableGroups = new Map<string, typeof tablesMeta>();
      for (const m of tablesMeta) {
        if (!tableGroups.has(m.tableName)) tableGroups.set(m.tableName, []);
        tableGroups.get(m.tableName)!.push(m);
      }
      for (const [tableName, rows] of tableGroups) {
        const tableMeta = rows.find((r) => !r.columnName);
        const colMetas = rows.filter((r) => r.columnName);
        lines.push(`\n### \`${tableName}\``);
        if (tableMeta?.businessName) lines.push(`- **业务名**: ${tableMeta.businessName}`);
        if (tableMeta?.description) lines.push(`- **描述**: ${tableMeta.description}`);
        if (tableMeta?.timezone)
          lines.push(`- **时区**: ${tableMeta.timezone} (写 SQL 时记得 AT TIME ZONE)`);
        if (tableMeta?.synonyms?.length)
          lines.push(`- **同义词**: ${tableMeta.synonyms.join(', ')}`);
        if (colMetas.length > 0) {
          lines.push('\n  | 字段 | 业务名 | 描述 | 单位 | 同义词 |');
          lines.push('  | --- | --- | --- | --- | --- |');
          for (const c of colMetas) {
            lines.push(
              `  | \`${c.columnName}\` | ${c.businessName || '-'} | ${c.description || '-'} | ${c.unit || '-'} | ${(c.synonyms || []).join(', ') || '-'} |`,
            );
          }
        }
      }
    }

    if (glossary.length > 0) {
      lines.push('\n## 业务术语词典');
      for (const g of glossary) {
        const scope = g.appliesToTables?.length ? ` (仅 ${g.appliesToTables.join(', ')})` : '';
        lines.push(`- **${g.term}**${scope}: ${g.meaning}`);
        if (g.exampleSql) lines.push(`  - SQL 示例: \`${g.exampleSql}\``);
      }
    }

    const learned = questions.filter((q) => q.source === 'learned' && q.learnedSql);
    if (learned.length > 0) {
      lines.push('\n## 历史成功样例（参考，但要根据当前问题调整）');
      for (const q of learned.slice(0, 5)) {
        lines.push(`- 问题: "${q.questionText}"`);
        lines.push(`  SQL: \`${q.learnedSql}\``);
      }
    }

    return lines.join('\n');
  }

  /**
   * 历史上下文：最近 N 轮的紧凑摘要（含 SQL + 前几行真实数据）
   * 更早的轮次只提一句"还有 N 轮更早历史，可调 list_previous_turns 查看"
   * Token 预算 80k 软上限：从最旧的开始砍数据快照
   */
  private async buildHistoryContext(conversationId?: string): Promise<string | null> {
    if (!conversationId) return null;
    const recent = await this.recall.getRecentArtifacts(
      conversationId,
      RECENT_TURNS_TO_SUMMARIZE,
    );
    if (recent.length === 0) return null;
    recent.reverse(); // 老的在前，新的在后

    const allTurnsCount = await this.recall.listTurns(conversationId).then((t) => t.length);
    const earlierCount = allTurnsCount - recent.length;

    const lines: string[] = ['# 本对话历史（最新在最后）'];
    if (earlierCount > 0) {
      lines.push(
        `\n_还有更早的 ${earlierCount} 轮未在此展示。需要时调用 list_previous_turns 看清单，调用 recall_turn_result 拉具体数据。_`,
      );
    }

    let droppedSnapshots = 0;
    for (let i = 0; i < recent.length; i++) {
      const a = recent[i];
      const isLast = i === recent.length - 1;
      lines.push(`\n## 轮次 ${a.turnIndex}`);
      lines.push(`**用户问**: ${a.userQuestion}`);
      if (a.refused) {
        lines.push(`**助手**: [拒答] ${(a.assistantNarrative || '').substring(0, 200)}`);
        continue;
      }
      if (a.finalSql) {
        lines.push(`**SQL**:\n\`\`\`sql\n${a.finalSql}\n\`\`\``);
      }
      if (typeof a.resultRowCount === 'number') {
        lines.push(`**结果**: 共 ${a.resultRowCount} 行`);
      }

      // 数据快照：最后一轮多给一些，更早的少给（或一旦超预算砍掉）
      const overBudget = this.estimateTokens(lines) > TOKEN_BUDGET;
      if (overBudget && !isLast) {
        droppedSnapshots++;
      } else if (a.resultColumns && a.resultRows && a.resultRows.length > 0) {
        const snapshotN = isLast ? 8 : 3;
        const cols = a.resultColumns.map((c) => c.name).join(' | ');
        const rows = a.resultRows.slice(0, snapshotN).map((r) =>
          a.resultColumns!.map((c) => this.fmtCell(r[c.name])).join(' | '),
        );
        lines.push(`**数据快照**（前 ${rows.length} 行）:`);
        lines.push('```');
        lines.push(cols);
        lines.push(rows.join('\n'));
        lines.push('```');
      }

      if (a.assistantNarrative) {
        const maxLen = isLast ? 800 : 300;
        const narr = a.assistantNarrative.length > maxLen
          ? a.assistantNarrative.substring(0, maxLen) + '...'
          : a.assistantNarrative;
        lines.push(`**助手**: ${narr}`);
      }
    }

    if (droppedSnapshots > 0) {
      lines.push(
        `\n_(注：${droppedSnapshots} 个早期轮次的数据快照已为节省 token 而省略，可用 recall_turn_result 召回)_`,
      );
    }

    const finalText = lines.join('\n');
    const finalTokens = this.estimateTokens([finalText]);
    if (finalTokens > HARD_TOKEN_LIMIT) {
      this.logger.warn(
        `History context ~${finalTokens} tokens still over hard limit ${HARD_TOKEN_LIMIT}; truncating`,
      );
      return finalText.substring(0, HARD_TOKEN_LIMIT * 4);
    }
    return finalText;
  }

  private buildUserQuestionContext(question: string): string {
    // 检测：是不是 clarify 合并后的 question（由 ChatService.buildMergedClarifyQuestion 拼出）
    const isClarifyReply = question.includes('原始问题：') && question.includes('（你上一轮澄清问的是：');
    const clarifyGuard = isClarifyReply
      ? `\n\n⚠️ **本次 user 内容是上一轮 clarify 的回答（已经合并好）**。\n` +
        `**严禁**再次调起 clarify。即使你觉得信息还不够明确，也**必须**按你判断的最合理口径直接执行 SQL 并给出数据。\n` +
        `如果用户答案确实模糊，可在 narrative 末尾用一行说明你选用的口径假设，但**仍然要给出具体数据**。`
      : '';
    return `用户问题：\n${question}${clarifyGuard}`;
  }

  // ===================== Helpers =====================

  private toolResultMessage(toolCallId: string, toolName: string, output: any): ToolResultMessage {
    return {
      role: 'tool',
      toolCallId,
      toolName,
      content: typeof output === 'string' ? output : JSON.stringify(output),
    };
  }

  private summarizeForLLM(name: string, output: any): any {
    if (!output || output.error) return output;
    if (name === 'run_sql' && Array.isArray(output.rows) && output.rows.length > 10) {
      return {
        ...output,
        rows: output.rows.slice(0, 10),
        _note: `结果共 ${output.rowCount} 行，仅返回前 10 行给 LLM 节省 token；完整结果已保留供出图用。`,
      };
    }
    if (name === 'sample_rows' && Array.isArray(output.rows) && output.rows.length > 10) {
      return { ...output, rows: output.rows.slice(0, 10) };
    }
    return output;
  }

  private summarizeForLog(name: string, output: any): any {
    if (!output || output.error) return output;
    if (name === 'run_sql' && output.rows) {
      return {
        ok: output.ok,
        dryRun: output.dryRun,
        rowCount: output.rowCount,
        columns: output.columns,
        firstRows: output.rows.slice(0, 3),
        executionTimeMs: output.executionTimeMs,
      };
    }
    return output;
  }

  private fmtCell(v: any): string {
    if (v == null) return '-';
    if (typeof v === 'number') return Number.isInteger(v) ? String(v) : v.toFixed(2);
    if (typeof v === 'object') return JSON.stringify(v).substring(0, 40);
    return String(v).substring(0, 40);
  }

  /** 粗略估算 token：英文按 4 chars/token，中文按 2 chars/token，取平均 3 */
  private estimateTokens(parts: string[]): number {
    return Math.ceil(parts.reduce((sum, s) => sum + s.length, 0) / 3);
  }
}

/**
 * Drain a planner generator to completion, optionally consuming each event.
 *
 * 用于非 SSE 路径（sub-agent / 单元测试 / 旧调用方）。SSE 端点直接消费 generator，不用这个。
 *
 * **clarify 处理**：sub-agent 路径下 planner prompt 已禁止 clarify，理论不触发；
 * 真触发时按"未答"处理（fallback 已在 planner.runStream 里：当 next() 返回 undefined
 * 时 finalize 会带着 clarify 字段返回，由上层兜底）。
 *
 * @param gen runStream() 返回的 generator
 * @param onEvent 可选事件回调（用于 trace / debug；不影响主流程）
 */
export async function drainPlanner(
  gen: AsyncGenerator<PlannerEvent, PlannerOutput, string | undefined>,
  onEvent?: (ev: PlannerEvent) => void,
): Promise<PlannerOutput> {
  while (true) {
    const result = await gen.next();
    if (result.done) return result.value;
    if (onEvent) onEvent(result.value);
  }
}
