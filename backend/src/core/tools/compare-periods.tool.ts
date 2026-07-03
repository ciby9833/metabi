import { Injectable, Logger } from '@nestjs/common';
import { SqlSafetyService } from '../sql-engine/sql-safety.service';
import { SqlExecutorService } from '../sql-engine/sql-executor.service';
import { AgentTool, ToolContext, ToolDefinition } from './tool.types';

interface Input {
  /** 指标聚合表达式，例如 COUNT(DISTINCT waybill_no) */
  metric_expression: string;
  /** 含 schema 的表名 */
  table: string;
  /** 当前期 WHERE，不含 WHERE 关键字 */
  current_period_where: string;
  /** 对照期 WHERE */
  previous_period_where: string;
  /** 时间维度（可选），按这个分组对比每个时间点 */
  time_dimension?: string;
  /** 当前期 / 对照期对应的中文标签，用于结果可读性，如 "5月22日" / "5月15日" */
  current_label?: string;
  previous_label?: string;
}

interface PointDelta {
  /** 时间点（如果有 time_dimension）或 'TOTAL' */
  dim: string;
  current: number;
  previous: number;
  delta: number;
  deltaPct: number;
}

interface Output {
  ok: boolean;
  metric: string;
  table: string;
  currentLabel: string;
  previousLabel: string;
  /** 总览：当前期总值 / 对照期总值 / Δ / Δ% */
  totalCurrent: number;
  totalPrevious: number;
  totalDelta: number;
  totalDeltaPct: number;
  /** 按时间点的明细（如果传了 time_dimension） */
  points: PointDelta[];
  /** 给前端 ChartAgent 看：建议的图表类型 */
  suggestedChart: 'comparison_line' | 'comparison_bar' | 'comparison_table';
  /** 文字总结，可直接用作 narrative */
  summary: string;
  error?: string;
}

/**
 * 同比 / 环比对比工具
 *
 * 一次调用搞定：拿到当前期 + 对照期两组数据，算总变化 + 时间点级变化
 * 让 LLM 不必自己写两个 SQL + 自己算 delta
 */
@Injectable()
export class ComparePeriodsTool implements AgentTool<Input, Output> {
  private readonly logger = new Logger(ComparePeriodsTool.name);

  readonly definition: ToolDefinition = {
    name: 'compare_periods',
    description:
      '【同比/环比/对比专用】对一个指标做"当前期 vs 对照期"的对比分析。' +
      '场景：用户问"同比/环比/上周对比/上月对比/对比..."类问题。' +
      '工具会一次性返回总变化 + 每个时间点的对比 + 推荐的对比图表类型。' +
      '示例：metric_expression="COUNT(DISTINCT waybill_no)", ' +
      'time_dimension="DATE(dispatch_time AT TIME ZONE \'Asia/Jakarta\')", ' +
      'current_period_where="dispatch_time >= \'2026-05-17\' AND dispatch_time < \'2026-05-24\'", ' +
      'previous_period_where="dispatch_time >= \'2026-05-10\' AND dispatch_time < \'2026-05-17\'"',
    parameters: {
      type: 'object',
      properties: {
        metric_expression: { type: 'string', description: '指标聚合表达式' },
        table: { type: 'string', description: '含 schema 的完整表名' },
        current_period_where: { type: 'string', description: '当前期 WHERE' },
        previous_period_where: { type: 'string', description: '对照期 WHERE' },
        time_dimension: {
          type: 'string',
          description: '可选的时间分组维度（按它拆每个时间点的对比），不传则只算总值',
        },
        current_label: { type: 'string', description: '当前期人话标签，如"本周"' },
        previous_label: { type: 'string', description: '对照期人话标签，如"上周"' },
      },
      required: ['metric_expression', 'table', 'current_period_where', 'previous_period_where'],
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
    const currentLabel = input.current_label || '当前期';
    const previousLabel = input.previous_label || '对照期';

    try {
      const points = input.time_dimension
        ? await this.runDetailedComparison(input, ctx)
        : await this.runTotalComparison(input, ctx);

      const totalCurrent = points.reduce((s, p) => s + p.current, 0);
      const totalPrevious = points.reduce((s, p) => s + p.previous, 0);
      const totalDelta = totalCurrent - totalPrevious;
      const totalDeltaPct = totalPrevious > 0 ? totalDelta / totalPrevious : 0;

      const suggestedChart =
        points.length >= 3 && input.time_dimension
          ? 'comparison_line'
          : points.length === 1
            ? 'comparison_table'
            : 'comparison_bar';

      const summary = this.buildSummary(
        currentLabel,
        previousLabel,
        totalCurrent,
        totalPrevious,
        totalDelta,
        totalDeltaPct,
        points,
      );

      return {
        ok: true,
        metric: input.metric_expression,
        table: input.table,
        currentLabel,
        previousLabel,
        totalCurrent,
        totalPrevious,
        totalDelta,
        totalDeltaPct,
        points,
        suggestedChart,
        summary,
      };
    } catch (err) {
      return {
        ok: false,
        metric: input.metric_expression,
        table: input.table,
        currentLabel,
        previousLabel,
        totalCurrent: 0,
        totalPrevious: 0,
        totalDelta: 0,
        totalDeltaPct: 0,
        points: [],
        suggestedChart: 'comparison_table',
        summary: '',
        error: (err as Error).message,
      };
    }
  }

  /** 不分时间维度，只算总值 */
  private async runTotalComparison(input: Input, ctx: ToolContext): Promise<PointDelta[]> {
    const sql = `
SELECT
  (SELECT ${input.metric_expression}::numeric FROM ${input.table} WHERE ${input.current_period_where}) AS current_val,
  (SELECT ${input.metric_expression}::numeric FROM ${input.table} WHERE ${input.previous_period_where}) AS previous_val
    `;
    this.safety.validate(sql);
    const result = await this.executor.execute(sql, ctx.datasourceId, {
      userId: ctx.userId,
      conversationId: ctx.conversationId,
    });
    const row = result.rows[0] || {};
    const cur = Number(row.current_val) || 0;
    const prev = Number(row.previous_val) || 0;
    return [
      {
        dim: 'TOTAL',
        current: cur,
        previous: prev,
        delta: cur - prev,
        deltaPct: prev > 0 ? (cur - prev) / prev : 0,
      },
    ];
  }

  /** 按 time_dimension 分组的细粒度对比，用 FULL OUTER JOIN 对齐两期 */
  private async runDetailedComparison(input: Input, ctx: ToolContext): Promise<PointDelta[]> {
    const td = input.time_dimension!;
    const sql = `
WITH cur AS (
  SELECT ${td} AS dim, ${input.metric_expression}::numeric AS val
  FROM ${input.table} WHERE ${input.current_period_where}
  GROUP BY ${td}
),
prev AS (
  SELECT ${td} AS dim, ${input.metric_expression}::numeric AS val
  FROM ${input.table} WHERE ${input.previous_period_where}
  GROUP BY ${td}
)
SELECT
  COALESCE(cur.dim::text, prev.dim::text) AS dim,
  COALESCE(cur.val, 0) AS current_val,
  COALESCE(prev.val, 0) AS previous_val
FROM cur
FULL OUTER JOIN prev ON cur.dim = prev.dim
ORDER BY 1
LIMIT 1000
    `;
    this.safety.validate(sql);
    const result = await this.executor.execute(sql, ctx.datasourceId, {
      userId: ctx.userId,
      conversationId: ctx.conversationId,
    });
    return result.rows.map((r) => {
      const cur = Number(r.current_val) || 0;
      const prev = Number(r.previous_val) || 0;
      return {
        dim: String(r.dim ?? '-'),
        current: cur,
        previous: prev,
        delta: cur - prev,
        deltaPct: prev > 0 ? (cur - prev) / prev : 0,
      };
    });
  }

  private buildSummary(
    curLabel: string,
    prevLabel: string,
    totalCur: number,
    totalPrev: number,
    totalDelta: number,
    totalDeltaPct: number,
    points: PointDelta[],
  ): string {
    const dir = totalDelta >= 0 ? '增长' : '下降';
    const pctSign = totalDelta >= 0 ? '+' : '';
    const main = `${curLabel} ${this.fmt(totalCur)} vs ${prevLabel} ${this.fmt(totalPrev)}，` +
      `${dir} ${this.fmt(Math.abs(totalDelta))} (${pctSign}${(totalDeltaPct * 100).toFixed(1)}%)`;

    if (points.length <= 1 || points[0].dim === 'TOTAL') return main;

    const positive = points.filter((p) => p.delta > 0).sort((a, b) => b.delta - a.delta);
    const negative = points.filter((p) => p.delta < 0).sort((a, b) => a.delta - b.delta);
    const extremes: string[] = [];
    if (positive[0]) {
      extremes.push(`增长最多：${positive[0].dim} (+${this.fmt(positive[0].delta)})`);
    }
    if (negative[0]) {
      extremes.push(`下降最多：${negative[0].dim} (${this.fmt(negative[0].delta)})`);
    }
    return `${main}。${extremes.join('；')}`;
  }

  private fmt(v: number): string {
    if (!isFinite(v)) return '-';
    if (Math.abs(v) >= 10000) return `${(v / 10000).toFixed(1)}万`;
    if (Math.abs(v) >= 1000) return v.toFixed(0);
    return v.toFixed(1);
  }
}
