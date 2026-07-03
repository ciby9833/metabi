import { Injectable } from '@nestjs/common';
import { SqlSafetyService } from '../sql-engine/sql-safety.service';
import { SqlExecutorService } from '../sql-engine/sql-executor.service';
import { AgentTool, ToolContext, ToolDefinition } from './tool.types';

interface Input {
  /** 事件表名（含 schema） */
  events_table: string;
  /** 用户标识列 */
  user_column: string;
  /** 事件时间戳列 */
  time_column: string;
  /** 队列周期：day / week / month */
  cohort_period?: 'day' | 'week' | 'month';
  /** 计算多少期的留存（默认 8）*/
  periods?: number;
  /** 起始队列日期范围（可选）*/
  start_date?: string;
  end_date?: string;
}

interface CohortPoint {
  cohort: string;
  cohortSize: number;
  retained: number[]; // retained[i] = 第 i 期还活跃的人数
  retentionRate: number[]; // retained[i] / cohortSize
}

interface Output {
  ok: boolean;
  cohortPeriod: string;
  periods: number;
  cohorts: CohortPoint[];
  summary: string;
  error?: string;
}

/**
 * 留存分析（cohort retention）
 *
 * 计算：按某周期把用户分组（首次活跃为队列锚点），之后 N 个周期分别有多少人回来活跃
 * MVP：单表内的事件留存。复杂场景（多事件类型 / 倍数计算）后续再加
 */
@Injectable()
export class CohortRetentionTool implements AgentTool<Input, Output> {
  readonly definition: ToolDefinition = {
    name: 'cohort_retention',
    description:
      '【留存分析专用】按周期计算用户留存：以首次活跃日为队列锚点，统计之后 N 期还活跃的占比。' +
      '场景：用户问"次日留存/周留存/月留存/新用户回访率"等。' +
      '需要表里有用户标识列和事件时间戳列。',
    parameters: {
      type: 'object',
      properties: {
        events_table: { type: 'string', description: '事件表（含 schema），如 dwd.user_events' },
        user_column: { type: 'string', description: '用户标识列' },
        time_column: { type: 'string', description: '事件时间戳列' },
        cohort_period: {
          type: 'string',
          enum: ['day', 'week', 'month'],
          description: '队列周期，默认 day',
        },
        periods: { type: 'integer', minimum: 1, maximum: 30, description: '留存期数，默认 8' },
        start_date: { type: 'string', description: '可选：起始日期 YYYY-MM-DD' },
        end_date: { type: 'string', description: '可选：结束日期 YYYY-MM-DD' },
      },
      required: ['events_table', 'user_column', 'time_column'],
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
    const cohortPeriod = input.cohort_period || 'day';
    const periods = Math.min(input.periods || 8, 30);
    const truncFn = cohortPeriod === 'day' ? 'day' : cohortPeriod === 'week' ? 'week' : 'month';
    const dateFilter = input.start_date && input.end_date
      ? `WHERE date_trunc('${truncFn}', ${input.time_column}) BETWEEN DATE '${input.start_date}' AND DATE '${input.end_date}'`
      : '';

    try {
      const sql = `
WITH first_activity AS (
  SELECT ${input.user_column} AS uid,
         MIN(date_trunc('${truncFn}', ${input.time_column}))::date AS cohort
  FROM ${input.events_table}
  ${dateFilter}
  GROUP BY ${input.user_column}
),
events_bucketed AS (
  SELECT e.${input.user_column} AS uid,
         date_trunc('${truncFn}', e.${input.time_column})::date AS event_period
  FROM ${input.events_table} e
  GROUP BY 1, 2
),
joined AS (
  SELECT fa.cohort,
         fa.uid,
         eb.event_period,
         (eb.event_period - fa.cohort) AS days_since
  FROM first_activity fa
  JOIN events_bucketed eb ON eb.uid = fa.uid AND eb.event_period >= fa.cohort
)
SELECT cohort::text AS cohort,
       COUNT(DISTINCT uid) FILTER (WHERE days_since = 0) AS p0,
       ${Array.from({ length: periods - 1 }, (_, i) =>
         `COUNT(DISTINCT uid) FILTER (WHERE days_since = ${this.periodOffsetExpr(cohortPeriod, i + 1)}) AS p${i + 1}`,
       ).join(',\n       ')}
FROM joined
GROUP BY cohort
ORDER BY cohort
LIMIT 200
      `;
      this.safety.validate(sql);
      const result = await this.executor.execute(sql, ctx.datasourceId, {
        userId: ctx.userId,
        conversationId: ctx.conversationId,
      });

      const cohorts: CohortPoint[] = result.rows.map((r) => {
        const cohortSize = Number(r.p0) || 0;
        const retained = Array.from({ length: periods }, (_, i) => Number(r[`p${i}`]) || 0);
        const retentionRate = retained.map((n) => (cohortSize > 0 ? n / cohortSize : 0));
        return { cohort: String(r.cohort), cohortSize, retained, retentionRate };
      });

      return {
        ok: true,
        cohortPeriod,
        periods,
        cohorts,
        summary: this.buildSummary(cohorts, cohortPeriod, periods),
      };
    } catch (err) {
      return {
        ok: false,
        cohortPeriod,
        periods,
        cohorts: [],
        summary: '',
        error: (err as Error).message,
      };
    }
  }

  private periodOffsetExpr(period: string, n: number): string {
    // PostgreSQL date - date = integer days
    if (period === 'day') return String(n);
    if (period === 'week') return String(n * 7);
    // month 用近似 30 天，对 cohort 分析够用
    return String(n * 30);
  }

  private buildSummary(cohorts: CohortPoint[], period: string, periods: number): string {
    if (cohorts.length === 0) return '没找到符合条件的数据';
    // 平均 p1 留存
    const validP1 = cohorts.filter((c) => c.cohortSize > 0).map((c) => c.retentionRate[1] || 0);
    const avgP1 = validP1.length > 0 ? validP1.reduce((s, v) => s + v, 0) / validP1.length : 0;
    return `共 ${cohorts.length} 个队列，平均次${period === 'day' ? '日' : period === 'week' ? '周' : '月'}留存率 ${(avgP1 * 100).toFixed(1)}%。`;
  }
}
