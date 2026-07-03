import { Injectable, Logger } from '@nestjs/common';
import { SqlSafetyService } from '../sql-engine/sql-safety.service';
import { SqlExecutorService } from '../sql-engine/sql-executor.service';
import { AgentTool, ToolContext, ToolDefinition } from './tool.types';

interface Input {
  /**
   * 待归因的指标 SQL 表达式，例如 'COUNT(DISTINCT waybill_no)' / 'SUM(piece_count)'
   * 不要带 SELECT、FROM、GROUP BY
   */
  metric_expression: string;
  /** 数据所在表（含 schema） */
  table: string;
  /** 维度字段名列表，会逐个分组分析 */
  dimensions: string[];
  /** 当前期 WHERE 条件（不含 WHERE 关键字），例如 "source_date = '2026-05-23'" */
  current_period_where: string;
  /** 基线期 WHERE 条件，例如 "source_date BETWEEN '2026-05-17' AND '2026-05-22'" */
  baseline_period_where?: string;
  /** 每个维度最多看 Top N 值（默认 5） */
  top_n?: number;
}

interface DimensionContribution {
  value: string;
  current: number;
  baseline: number;
  delta: number;
  /** 占当前期总指标的比例 */
  shareOfCurrent: number;
  /** 对总变化的贡献率（delta_i / total_delta） */
  contributionPct: number;
}

interface DimensionResult {
  dimension: string;
  totalCurrent: number;
  totalBaseline: number;
  totalDelta: number;
  totalDeltaPct: number;
  topContributors: DimensionContribution[];
  insight: string;
}

interface Output {
  ok: boolean;
  metric: string;
  table: string;
  hasBaseline: boolean;
  results?: DimensionResult[];
  summary?: string;
  error?: string;
}

/**
 * decompose_by_dimensions
 *
 * 用户问"为什么 X 变化"时，对每个维度逐个分组对比：
 *   - 算每个 dim_value 在当前期/基线期的指标
 *   - 算 delta 和 contribution
 *   - 排序找出最大贡献者
 *
 * 完全确定性，不依赖 LLM 二次推理。
 * 单次工具调用最多跑 dimensions.length × 1 条 SQL（合并查询）。
 */
@Injectable()
export class DecomposeByDimensionsTool implements AgentTool<Input, Output> {
  private readonly logger = new Logger(DecomposeByDimensionsTool.name);

  readonly definition: ToolDefinition = {
    name: 'decompose_by_dimensions',
    description:
      '【归因专用】对一个指标按多个维度逐个分组，对比当前期 vs 基线期，找出贡献最大的维度值。' +
      '只在用户问"为什么/差异/原因/归因/变化"类问题时使用。例如用户问"5/23 单量为什么这么高"，' +
      '传入 metric_expression="COUNT(DISTINCT waybill_no)"，' +
      'dimensions=["agent_area_name","station_name"]，' +
      'current_period_where="source_date=\'2026-05-23\'", ' +
      'baseline_period_where="source_date BETWEEN \'2026-05-17\' AND \'2026-05-22\'"。' +
      '工具会自动算各维度贡献度并排序。',
    parameters: {
      type: 'object',
      properties: {
        metric_expression: {
          type: 'string',
          description: '指标聚合表达式，例如 COUNT(DISTINCT waybill_no), SUM(piece_count)',
        },
        table: { type: 'string', description: '含 schema 的完整表名，例如 dwd.dispatcher_efficiency_detail' },
        dimensions: {
          type: 'array',
          items: { type: 'string' },
          description: '维度字段名列表，会逐个分析',
        },
        current_period_where: {
          type: 'string',
          description: '当前期过滤条件（不含 WHERE 关键字）',
        },
        baseline_period_where: {
          type: 'string',
          description: '对照基线期过滤条件；不传则只算当前期分布',
        },
        top_n: {
          type: 'integer',
          minimum: 1,
          maximum: 20,
          description: '每个维度返回的 Top N，默认 5',
        },
      },
      required: ['metric_expression', 'table', 'dimensions', 'current_period_where'],
      additionalProperties: false,
    },
    // 企业 datasource 专用：基于业务 metric/SQL 模板的计算工具，不适合用户上传的小型 dataset
    availability: 'enterprise_only',
  };

  constructor(
    private readonly safety: SqlSafetyService,
    private readonly executor: SqlExecutorService,
  ) {}

  async execute(input: Input, ctx: ToolContext): Promise<Output> {
    const topN = Math.min(input.top_n || 5, 20);
    const hasBaseline = !!input.baseline_period_where;

    const results: DimensionResult[] = [];

    for (const dim of input.dimensions) {
      try {
        const result = await this.analyzeDimension(input, dim, topN, hasBaseline, ctx);
        if (result) results.push(result);
      } catch (err) {
        this.logger.warn(`Decomposition by ${dim} failed: ${(err as Error).message}`);
      }
    }

    if (results.length === 0) {
      return {
        ok: false,
        metric: input.metric_expression,
        table: input.table,
        hasBaseline,
        error: '所有维度都分析失败',
      };
    }

    return {
      ok: true,
      metric: input.metric_expression,
      table: input.table,
      hasBaseline,
      results,
      summary: this.buildOverallSummary(results, hasBaseline),
    };
  }

  /**
   * 对一个维度做对比分析
   * 单条合并查询：
   *   SELECT dim, period, metric, ...
   *   FROM (
   *     SELECT dim, 'current' AS period, <metric> AS val FROM table WHERE <current> GROUP BY dim
   *     UNION ALL
   *     SELECT dim, 'baseline' AS period, <metric> AS val FROM table WHERE <baseline> GROUP BY dim
   *   ) t
   */
  private async analyzeDimension(
    input: Input,
    dim: string,
    topN: number,
    hasBaseline: boolean,
    ctx: ToolContext,
  ): Promise<DimensionResult | null> {
    const baselinePart = hasBaseline
      ? `, (SELECT ${input.metric_expression} FROM ${input.table} WHERE ${input.baseline_period_where} AND ${dim} IS NOT NULL GROUP BY ${dim} HAVING ${dim} IS NOT NULL) baseline_part`
      : '';
    // 用 FULL OUTER JOIN 把当前期和基线期对齐
    const sql = hasBaseline
      ? `
WITH cur AS (
  SELECT ${dim} AS dim_val, ${input.metric_expression} AS val
  FROM ${input.table}
  WHERE (${input.current_period_where}) AND ${dim} IS NOT NULL
  GROUP BY ${dim}
),
base AS (
  SELECT ${dim} AS dim_val, ${input.metric_expression} AS val
  FROM ${input.table}
  WHERE (${input.baseline_period_where}) AND ${dim} IS NOT NULL
  GROUP BY ${dim}
)
SELECT
  COALESCE(cur.dim_val, base.dim_val) AS dim_val,
  COALESCE(cur.val, 0)::numeric AS current_val,
  COALESCE(base.val, 0)::numeric AS baseline_val
FROM cur
FULL OUTER JOIN base ON cur.dim_val = base.dim_val
LIMIT 500
      `
      : `
SELECT ${dim} AS dim_val,
       ${input.metric_expression}::numeric AS current_val,
       0::numeric AS baseline_val
FROM ${input.table}
WHERE (${input.current_period_where}) AND ${dim} IS NOT NULL
GROUP BY ${dim}
ORDER BY current_val DESC
LIMIT 500
      `;

    this.safety.validate(sql);
    const result = await this.executor.execute(sql, ctx.datasourceId, {
      userId: ctx.userId,
      conversationId: ctx.conversationId,
      useCache: true,
    });
    if (result.rowCount === 0) return null;

    const rows = result.rows.map((r) => ({
      value: String(r.dim_val ?? '(null)'),
      current: Number(r.current_val) || 0,
      baseline: Number(r.baseline_val) || 0,
    }));

    const totalCurrent = rows.reduce((s, r) => s + r.current, 0);
    const totalBaseline = rows.reduce((s, r) => s + r.baseline, 0);
    const totalDelta = totalCurrent - totalBaseline;

    const contributors: DimensionContribution[] = rows.map((r) => {
      const delta = r.current - r.baseline;
      return {
        value: r.value,
        current: r.current,
        baseline: r.baseline,
        delta,
        shareOfCurrent: totalCurrent > 0 ? r.current / totalCurrent : 0,
        contributionPct: Math.abs(totalDelta) > 0 ? delta / totalDelta : 0,
      };
    });

    // 按 abs(delta) 排序，取 Top N
    contributors.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
    const top = contributors.slice(0, topN);

    return {
      dimension: dim,
      totalCurrent,
      totalBaseline,
      totalDelta,
      totalDeltaPct: totalBaseline > 0 ? totalDelta / totalBaseline : 0,
      topContributors: top,
      insight: this.buildDimensionInsight(dim, totalDelta, totalBaseline, top, hasBaseline),
    };
  }

  private buildDimensionInsight(
    dim: string,
    totalDelta: number,
    totalBaseline: number,
    top: DimensionContribution[],
    hasBaseline: boolean,
  ): string {
    if (!hasBaseline) {
      const top1 = top[0];
      return top1
        ? `按 ${dim} 拆分：Top 1 是「${top1.value}」(${this.fmtNum(top1.current)})，占当前期 ${(top1.shareOfCurrent * 100).toFixed(1)}%`
        : `按 ${dim} 无有效数据`;
    }
    if (top.length === 0) return `按 ${dim} 无有效数据`;
    const positives = top.filter((c) => c.delta > 0);
    const negatives = top.filter((c) => c.delta < 0);
    const lines: string[] = [];
    if (positives.length > 0) {
      const p1 = positives[0];
      lines.push(
        `「${p1.value}」上涨 ${this.fmtDelta(p1.delta)}（基线 ${this.fmtNum(p1.baseline)} → 当前 ${this.fmtNum(p1.current)}），贡献 ${(p1.contributionPct * 100).toFixed(0)}%`,
      );
    }
    if (negatives.length > 0) {
      const n1 = negatives[0];
      lines.push(
        `「${n1.value}」下降 ${this.fmtDelta(n1.delta)}（基线 ${this.fmtNum(n1.baseline)} → 当前 ${this.fmtNum(n1.current)}）`,
      );
    }
    const totalChangePct = totalBaseline > 0
      ? ` (整体${totalDelta >= 0 ? '+' : ''}${((totalDelta / totalBaseline) * 100).toFixed(1)}%)`
      : '';
    return `维度 ${dim}${totalChangePct}：${lines.join('；')}`;
  }

  private buildOverallSummary(results: DimensionResult[], hasBaseline: boolean): string {
    if (!hasBaseline) {
      return `按 ${results.length} 个维度拆解了分布。重点关注每个维度的 Top 1。`;
    }
    // 找出整体变化最显著的维度
    const sorted = [...results].sort(
      (a, b) => Math.abs(b.totalDeltaPct) - Math.abs(a.totalDeltaPct),
    );
    const lines: string[] = [];
    for (const r of sorted.slice(0, 3)) {
      const top1 = r.topContributors[0];
      if (!top1) continue;
      const dir = top1.delta >= 0 ? '上涨' : '下降';
      lines.push(
        `**${r.dimension}**: 最大贡献者「${top1.value}」${dir} ${this.fmtDelta(Math.abs(top1.delta))} (${(top1.contributionPct * 100).toFixed(0)}% of total delta)`,
      );
    }
    return lines.join('\n');
  }

  private fmtNum(v: number): string {
    if (Math.abs(v) >= 10000) return `${(v / 10000).toFixed(1)}万`;
    if (Math.abs(v) >= 1000) return v.toFixed(0);
    return v.toFixed(1);
  }

  private fmtDelta(v: number): string {
    const sign = v >= 0 ? '+' : '';
    return `${sign}${this.fmtNum(v)}`;
  }
}
