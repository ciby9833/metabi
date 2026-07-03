import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ChartAgent, ChartConfig } from '../agents/chart.agent';
import { MasterPlannerAgent, drainMaster } from '../agents/master-planner.agent';
import { NarratorAgent } from '../agents/narrator.agent';
import { PlannerAgent, PlannerOutput, drainPlanner } from '../agents/planner.agent';
import { ReviewOutput } from '../agents/reviewer.agent';
import { StatisticalInsightService } from '../agents/statistical-insight.service';
import { Insight, ToolCallLog } from '../tools/tool.types';
import { LineageBadge, LineageService } from './lineage.service';
import { DatasourceMetadataService } from '../../modules/datasource/services/metadata.service';
import { Conversation } from '../../database/entities';
import { Skill } from '../../providers/skills/types';
import { SkillLoaderService } from '../../providers/skills/skill-loader.service';
import { FinalizePayload } from '../tools/tool.types';

/** Master / Single Planner 路径都返回这个统一形态，让 orchestrator 后续逻辑可复用 */
interface PlannerLikeOutput {
  finalize: FinalizePayload;
  trace: ToolCallLog[];
  totalTokens: number;
  totalLatencyMs: number;
  sqlResult?: PlannerOutput['sqlResult'];
  skill: Skill;
  rawMessages: any[];
}

export interface OrchestrateInput {
  question: string;
  datasourceId: string;
  conversationId?: string;
  userId?: string;
  /** 是否启用 Reviewer (默认 true) - 准确率优先模式 */
  withReview?: boolean;
}

export interface ProvenanceFooter {
  skill: { name: string; version: string };
  toolCallCount: number;
  steps: ToolCallLog[];
  totalLatencyMs: number;
  totalTokens: number;
  /** 走了 Reviewer 的话填这里 */
  review?: {
    confidence: number;
    concerns: string[];
    summary: string;
  };
}

export interface OrchestrateResult {
  /** 给用户看的中文播报 */
  narrative: string;
  /** 最终的 SQL (拒答时为空) */
  sql?: string;
  /** 置信度（经 Reviewer 调整后的）*/
  confidence: number;
  /** 是否拒答 */
  refused: boolean;
  /** 拒答时的原因 */
  refuseReason?: string;
  /** ECharts / 表格配置 */
  chart: ChartConfig;
  /** 结果数据（前端可能用于完整表格）*/
  data: {
    columns: { name: string; type: string }[];
    rows: Record<string, any>[];
  };
  resultSummary: {
    rowCount: number;
    truncated: boolean;
    executionTimeMs: number;
    fromCache: boolean;
  };
  /** Provenance footer：让用户能审计 */
  provenance: ProvenanceFooter;
  /** 完整 ConversationMessage[]，给 ChatService 写 turn_artifacts.raw_messages */
  rawMessages: any[];
  /** 本轮使用的 Skill 名（供锁定到 Conversation） */
  skillName: string;
  /** 主动洞见（LLM + 统计规则合并去重） */
  insights: Insight[];
  /** 下钻建议（前端展示为可点击 chip） */
  suggestedFollowUps: string[];
  /** 主动关联：用户没问到但 Skill 暗示相关的角度 */
  relatedHints: string[];
  /** 数据血缘 badge（涉及的表 / 行数 / 最近活动）*/
  lineage: LineageBadge[];
  /**
   * 字段技术名 → 业务展示名映射（来自 DatasourceMetadata.businessName）
   * 前端表格/图表渲染时优先用业务名，看不懂的字段才显示原始名
   * 例：{ dispatch_count: '派件量', station_name: '站点' }
   */
  columnDisplayMap: Record<string, string>;
  /** 关键澄清请求（LLM 主动调起，前端渲染卡片让用户答）*/
  clarify?: import('../tools/tool.types').ClarifyRequest;
}

/**
 * ChatOrchestrator (v2)
 *
 * 新架构流程：
 *   1. PlannerAgent (ReAct 循环 + Tools) → 输出 SQL + 数据 + finalize
 *   2. ReviewerAgent (子 Agent) → 质疑 + 调整置信度
 *   3. ChartAgent → 出图
 *   4. NarratorAgent → 仅在 Planner 没给足播报时补充
 *   5. 组装 ProvenanceFooter
 */
@Injectable()
export class ChatOrchestratorService {
  private readonly logger = new Logger(ChatOrchestratorService.name);

  /**
   * 三档置信度区间：
   *   confidence >= TRUST_THRESHOLD  → 正常输出
   *   REFUSE_THRESHOLD <= confidence < TRUST_THRESHOLD → 输出但显著警告
   *   confidence < REFUSE_THRESHOLD  → 拒答
   */
  private readonly REFUSE_THRESHOLD = 0.3;
  private readonly TRUST_THRESHOLD = 0.7;

  constructor(
    private readonly planner: PlannerAgent,
    private readonly master: MasterPlannerAgent,
    private readonly chartAgent: ChartAgent,
    private readonly narrator: NarratorAgent,
    private readonly statisticalInsights: StatisticalInsightService,
    private readonly lineageService: LineageService,
    private readonly metadata: DatasourceMetadataService,
    private readonly skillLoader: SkillLoaderService,
    @InjectRepository(Conversation)
    private readonly conversationRepo: Repository<Conversation>,
  ) {}

  async run(input: OrchestrateInput): Promise<OrchestrateResult> {
    const withReview = input.withReview !== false;
    const mode = await this.resolveMode(input.conversationId);
    this.logger.log(
      `Orchestrating mode=${mode} withReview=${withReview}: ${input.question.substring(0, 80)}`,
    );

    // 1) 选 Master 或 单 Skill Planner
    //    Master 模式：MasterAgent 调度多个 SkillAgent 子任务
    //    Single 模式：直接走老 Planner（行为同 Phase 2 之前，不降智）
    const plan: PlannerLikeOutput =
      mode === 'master'
        ? await this.runMaster(input)
        : await this.runSinglePlanner(input);

    return this.composeResultFromPlan(plan, input, withReview);
  }

  /**
   * Plan → OrchestrateResult — 复用于 HTTP run() 和 SSE 路径。
   *
   * Reviewer/Verifier 已在 Planner 内部 finalize gate 完成（含 retry loop），
   * 此处仅根据 finalize.confidence 决定渲染（refuse/warn/trust）。
   *
   * @param withReview deprecated — 保留入参兼容老 caller，实际无效（Planner 已内置）
   */
  async composeResultFromPlan(
    plan: PlannerLikeOutput,
    input: OrchestrateInput,
    withReview = true,
  ): Promise<OrchestrateResult> {
    void withReview; // 不再使用：Verifier 已在 Planner 内部跑过
    const confidence = plan.finalize.confidence;
    const refused = plan.finalize.refused || false;
    const refuseReason = plan.finalize.refuseReason;
    // 中度置信：拿到数据但 verifier 给了显著低分（>= REFUSE_THRESHOLD 但 < TRUST_THRESHOLD）
    const warnButShow =
      !refused && confidence < this.TRUST_THRESHOLD && confidence >= this.REFUSE_THRESHOLD;
    // Reviewer 已在 Planner 内部跑过，这里不再单独保留 review 对象
    const review: ReviewOutput | undefined = undefined as ReviewOutput | undefined;

    // 3) 构建结果数据
    const hasSqlResult = !!plan.sqlResult;
    const data = hasSqlResult
      ? { columns: plan.sqlResult!.columns, rows: plan.sqlResult!.rows }
      : { columns: [], rows: [] };

    const resultSummary = hasSqlResult
      ? {
          rowCount: plan.sqlResult!.rowCount,
          truncated: plan.sqlResult!.truncated,
          executionTimeMs: plan.sqlResult!.executionTimeMs || 0,
          fromCache: plan.sqlResult!.fromCache || false,
        }
      : { rowCount: 0, truncated: false, executionTimeMs: 0, fromCache: false };

    // 4) 图表
    const chart = refused || !hasSqlResult
      ? this.chartAgent.build({ columns: [], rows: [], rowCount: 0, truncated: false, executionTimeMs: 0 }, 'table')
      : this.chartAgent.build(
          {
            columns: plan.sqlResult!.columns,
            rows: plan.sqlResult!.rows,
            rowCount: plan.sqlResult!.rowCount,
            truncated: plan.sqlResult!.truncated,
            executionTimeMs: plan.sqlResult!.executionTimeMs || 0,
          },
          plan.finalize.chartType || 'auto',
        );

    // 5) 播报
    let narrative = plan.finalize.narrative;
    if (refused) {
      narrative = this.formatRefusal(narrative, refuseReason, review?.concerns || []);
    } else if (warnButShow && review && review.concerns.length > 0) {
      // 中度置信：警告但照出 —— 把警告放最前面，让用户先看到
      narrative = this.formatWarning(narrative, confidence, review.concerns);
    }

    // 6) Provenance footer
    const provenance: ProvenanceFooter = {
      skill: { name: plan.skill.meta.name, version: plan.skill.meta.version },
      toolCallCount: plan.trace.length,
      steps: plan.trace,
      totalLatencyMs: plan.totalLatencyMs,
      totalTokens: plan.totalTokens,
      review: review
        ? { confidence: review.confidence, concerns: review.concerns, summary: review.summary }
        : undefined,
    };

    // 合并 LLM insights + 统计规则 insights（去重）
    const llmInsights = plan.finalize.insights || [];
    const statInsights = hasSqlResult && !refused
      ? this.statisticalInsights.detect({
          columns: plan.sqlResult!.columns,
          rows: plan.sqlResult!.rows,
          rowCount: plan.sqlResult!.rowCount,
        })
      : [];
    const insights = this.dedupInsights([...statInsights, ...llmInsights]);

    const suggestedFollowUps = refused ? [] : plan.finalize.suggestedFollowUps || [];
    const relatedHints = refused ? [] : plan.finalize.relatedHints || [];

    // === 5 大功能兜底（master 和 single 路径共用）===
    // 目的：即使 LLM 在 finalize 时忘填 insights/suggestedFollowUps，前端依然有内容展示
    if (!refused && hasSqlResult) {
      if (insights.length === 0) {
        const r = plan.sqlResult!;
        insights.push({
          severity: 'info',
          kind: 'business',
          text: `查询返回 ${r.rowCount} 行 ${r.columns.length} 列。建议结合时间维度或拆分维度做进一步分析。`,
        });
      }
      if (suggestedFollowUps.length === 0) {
        // 通用兜底 — 让用户至少能继续往下点
        suggestedFollowUps.push('和上一周期做同环比对比', '按其他维度拆解一下', '导出完整数据');
      }
    }

    // 自动血缘 badge：解析 finalize 出来的 SQL，查各涉及表的统计信息
    const sqlForLineage =
      plan.finalize.sql?.trim() || plan.sqlResult?.generatedSql || '';
    let lineage: LineageBadge[] = [];
    try {
      lineage = await this.lineageService.buildBadges(sqlForLineage, input.datasourceId);
      // 新鲜度警告：用户问"今天/当前"但数据 > 24h 没刷新
      const staleWarnings = this.lineageService.findStaleWarnings(lineage, input.question);
      for (const w of staleWarnings) {
        insights.unshift({
          severity: 'warning',
          kind: 'data_quality',
          text: w.message,
        });
      }
    } catch (err) {
      this.logger.debug(`Lineage build failed: ${(err as Error).message}`);
    }

    // 字段技术名 → 业务名映射（用于前端友好展示表头）
    const columnDisplayMap = await this.buildColumnDisplayMap(input.datasourceId);

    // SQL 优先用 LLM finalize 提交的；为空时回退到工具产出的真实 SQL
    // （multidim_breakdown / stats_describe 内部跑过 SQL，generatedSql 是权威）
    const effectiveSql =
      plan.finalize.sql?.trim() || plan.sqlResult?.generatedSql || '';

    return {
      narrative,
      sql: effectiveSql,
      confidence,
      refused,
      refuseReason,
      chart,
      data,
      resultSummary,
      provenance,
      rawMessages: plan.rawMessages,
      skillName: plan.skill.meta.name,
      insights,
      suggestedFollowUps,
      relatedHints,
      lineage,
      columnDisplayMap,
      clarify: plan.finalize.clarify,
    };
  }

  // ============== Planner / Master 路径抽象 ==============

  // private 类型在 class 体外（同文件顶部）— 但 TS 不支持类内 type，所以直接在 helpers 区域用：
  // PlannerLikeOutput 在文件底部定义

  /** 决定走哪条 agent 路径 */
  private async resolveMode(
    conversationId?: string,
  ): Promise<'single_skill' | 'master'> {
    if (!conversationId) return 'single_skill';
    const conv = await this.conversationRepo.findOne({ where: { id: conversationId } });
    return conv?.mode === 'master' ? 'master' : 'single_skill';
  }

  /** 单 Skill 路径（HTTP req/resp 模式 — drain generator 到完成）*/
  private async runSinglePlanner(input: OrchestrateInput): Promise<PlannerLikeOutput> {
    const plan = await drainPlanner(
      this.planner.runStream({
        question: input.question,
        datasourceId: input.datasourceId,
        conversationId: input.conversationId,
        userId: input.userId,
      }),
    );
    return {
      finalize: plan.finalize,
      trace: plan.trace,
      totalTokens: plan.totalTokens,
      totalLatencyMs: plan.totalLatencyMs,
      sqlResult: plan.sqlResult,
      skill: plan.skill,
      rawMessages: plan.rawMessages,
    };
  }

  /** Master 路径（MasterAgent 调度多个 SkillAgent 子任务） */
  private async runMaster(input: OrchestrateInput): Promise<PlannerLikeOutput> {
    const m = await drainMaster(
      this.master.runStream({
        question: input.question,
        datasourceId: input.datasourceId,
        conversationId: input.conversationId,
        userId: input.userId,
      }),
    );
    // 选一个代表 skill：用最后一个子 agent 用的 skill；如果一个都没派则给 master 占位
    const representativeSkillName = m.subAgentCalls.length
      ? m.subAgentCalls[m.subAgentCalls.length - 1].skillName
      : '';
    const skill: Skill = representativeSkillName
      ? this.skillLoader.getByName(representativeSkillName) || this.buildMasterSkill(m.skillName)
      : this.buildMasterSkill(m.skillName);
    // master.trace 转成 ToolCallLog（前端可读），保留子任务 ID 用于树形展开
    const trace: ToolCallLog[] = m.trace.map((s) => ({
      step: s.step,
      name: s.name,
      input: s.input,
      output: s.output,
      durationMs: s.durationMs,
      timestamp: new Date().toISOString(),
    }));
    return {
      finalize: m.finalize,
      trace,
      totalTokens: m.totalTokens,
      totalLatencyMs: m.totalLatencyMs,
      sqlResult: m.sqlResult,
      skill,
      rawMessages: m.rawMessages,
    };
  }

  /** 给 Master 路径造一个"伪 Skill" 用于代表（避免后续代码 plan.skill 为空）*/
  private buildMasterSkill(name: string): Skill {
    return {
      meta: {
        name: name || 'master',
        version: '1.0.0',
        description: 'Master 调度多个子 agent 的合成结果',
        priority: 0,
      },
      body: '',
      filePath: 'virtual://master',
    } as Skill;
  }

  /** 把 DatasourceMetadata 里有 businessName 的列拍平成 { tech_name: business_name } */
  private async buildColumnDisplayMap(datasourceId: string): Promise<Record<string, string>> {
    try {
      const all = await this.metadata.getAllForDatasource(datasourceId);
      const map: Record<string, string> = {};
      for (const m of all) {
        if (m.columnName && m.businessName) {
          // 后写覆盖前写：跨表同名列以最后看到的业务名为准
          map[m.columnName] = m.businessName;
        }
      }
      return map;
    } catch (err) {
      this.logger.debug(`buildColumnDisplayMap failed: ${(err as Error).message}`);
      return {};
    }
  }

  /** 按 text 去重（避免 LLM 写出和统计规则一样的洞见）*/
  private dedupInsights(list: Insight[]): Insight[] {
    const seen = new Set<string>();
    const out: Insight[] = [];
    for (const i of list) {
      const key = i.text.trim().substring(0, 40);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(i);
    }
    return out;
  }

  private formatRefusal(plannerNarrative: string, reason?: string, concerns: string[] = []): string {
    const parts = ['🤔 我没办法可信地回答这个问题。'];
    if (plannerNarrative && !plannerNarrative.startsWith('🤔')) {
      parts.push(plannerNarrative);
    }
    if (reason) {
      parts.push(`\n原因：${reason}`);
    }
    if (concerns.length > 0) {
      parts.push(`\n具体疑点：\n${concerns.map((c) => `- ${c}`).join('\n')}`);
    }
    parts.push('\n建议你补充更明确的口径（时间范围、业务术语、维度），或换个数据源 / Skill 再试。');
    return parts.join('\n');
  }

  private formatWarning(plannerNarrative: string, confidence: number, concerns: string[]): string {
    const warnBlock = [
      `⚠️ **审查警示**（置信度 ${(confidence * 100).toFixed(0)}%，结果仅供参考）`,
      ...concerns.map((c) => `- ${c}`),
    ].join('\n');
    return `${warnBlock}\n\n---\n\n${plannerNarrative}`;
  }
}
