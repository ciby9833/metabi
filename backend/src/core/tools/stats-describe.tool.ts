import { Injectable, Logger } from '@nestjs/common';
import { SqlExecutorService } from '../sql-engine/sql-executor.service';
import { AgentTool, ToolContext, ToolDefinition } from './tool.types';

interface Input {
  /** 完整表名 */
  table: string;
  /** 要统计的数值字段（必须是 numeric / int / float / decimal）*/
  column: string;
  /** WHERE 子句（不含 WHERE）*/
  where?: string;
  /** 可选分组维度（1-2 个）— 每组算一行 stats */
  groupBy?: string[];
  /** 自定义百分位（0..1），不传则用默认套 [0.5, 0.75, 0.9, 0.99] */
  percentiles?: number[];
  /** 行数上限（仅 groupBy 时生效），默认 50 */
  topN?: number;
}

interface Output {
  ok: boolean;
  generatedSql: string;
  columns?: { name: string; type: string }[];
  rows?: Record<string, any>[];
  rowCount?: number;
  summary?: string;
  hint?: string;
  error?: string;
}

const IDENTIFIER_RE = /^[a-zA-Z_][\w]*(\.[a-zA-Z_][\w]*)?$/;

/**
 * stats_describe
 *
 * 一键算 count / null 数 / min / max / avg / stddev / median / p25 / p50 / p75 / p90 / p99
 *
 * 价值：
 *   - LLM 经常写错 PostgreSQL 百分位语法（必须 percentile_cont(0.5) WITHIN GROUP ORDER BY x）
 *   - 自动算 null_count、null_pct，让数据质量一目了然
 *   - 可按维度分组算（如各网点的派送时长 p99）
 */
@Injectable()
export class StatsDescribeTool implements AgentTool<Input, Output> {
  private readonly logger = new Logger(StatsDescribeTool.name);

  readonly definition: ToolDefinition = {
    name: 'stats_describe',
    description:
      '对一个数值字段算描述统计（count / null / min / max / avg / stddev / 多个百分位）。\n' +
      '✅ 使用场景：「派送时长的 p50/p90/p99 是多少」「各网点的平均运费分布」「客单价中位数」「重量字段的统计摘要」\n' +
      '工具自动用 PG percentile_cont 正确语法；自动算 null 占比；可选按维度分组。\n' +
      '比自己写 SQL 不容易出语法错。如果用户问的是分布而非统计，请用 multidim_breakdown。',
    parameters: {
      type: 'object',
      properties: {
        table: { type: 'string', description: '完整表名，如 dwd.waybill_detail' },
        column: { type: 'string', description: '数值字段名' },
        where: { type: 'string', description: 'WHERE 子句（不含 WHERE 关键字）' },
        groupBy: {
          type: 'array',
          items: { type: 'string' },
          description: '可选：按这些维度分组算（1-2 个）',
        },
        percentiles: {
          type: 'array',
          items: { type: 'number' },
          description: '自定义百分位列表 (0..1)，默认 [0.5, 0.75, 0.9, 0.99]',
        },
        topN: { type: 'number', description: '行数上限（仅 groupBy 时生效），默认 50' },
      },
      required: ['table', 'column'],
      additionalProperties: false,
    },
    // 企业 datasource 专用：基于业务 metric/SQL 模板的计算工具，不适合用户上传的小型 dataset
    availability: 'enterprise_only',
  };

  constructor(private readonly executor: SqlExecutorService) {}

  async execute(input: Input, ctx: ToolContext): Promise<Output> {
    try {
      this.validate(input);
    } catch (err) {
      return {
        ok: false,
        generatedSql: '',
        error: (err as Error).message,
        hint: '请修正参数后重试。',
      };
    }

    const sql = this.buildSql(input);
    try {
      const result = await this.executor.execute(sql, ctx.datasourceId, {
        conversationId: ctx.conversationId,
        userId: ctx.userId,
      });
      ctx.successfulSqlRuns = (ctx.successfulSqlRuns || 0) + 1;
      return {
        ok: true,
        generatedSql: sql,
        columns: result.columns,
        rows: result.rows,
        rowCount: result.rowCount,
        summary: input.groupBy?.length
          ? `已按 ${input.groupBy.join('、')} 分组计算 ${input.column} 的描述统计，共 ${result.rowCount} 组`
          : `已计算 ${input.column} 的描述统计：count/null/min/max/avg/stddev/${(input.percentiles || [0.5, 0.75, 0.9, 0.99]).map((p) => 'p' + Math.round(p * 100)).join('/')}`,
      };
    } catch (err) {
      return {
        ok: false,
        generatedSql: sql,
        error: (err as Error).message,
        hint: '执行失败。检查字段是否为数值型。建议改用 run_sql 自查。',
      };
    }
  }

  private validate(input: Input) {
    if (!input.table || !IDENTIFIER_RE.test(input.table)) {
      throw new Error(`table 非法: ${input.table}`);
    }
    if (!input.column || !IDENTIFIER_RE.test(input.column)) {
      throw new Error(`column 非法: ${input.column}`);
    }
    if (input.groupBy) {
      if (input.groupBy.length > 2) throw new Error('groupBy 最多 2 个');
      for (const g of input.groupBy) {
        if (!IDENTIFIER_RE.test(g)) throw new Error(`groupBy 字段非法: ${g}`);
      }
    }
    if (input.percentiles) {
      for (const p of input.percentiles) {
        if (typeof p !== 'number' || p <= 0 || p >= 1) {
          throw new Error(`percentile 必须在 (0, 1) 区间: ${p}`);
        }
      }
      if (input.percentiles.length > 10) throw new Error('percentiles 最多 10 个');
    }
  }

  private buildSql(input: Input): string {
    const col = input.column;
    const percentiles = input.percentiles && input.percentiles.length > 0
      ? input.percentiles
      : [0.5, 0.75, 0.9, 0.99];
    const where = input.where?.trim() ? `WHERE ${input.where.trim()}` : '';
    const topN = Math.min(Math.max(input.topN || 50, 1), 200);

    const pctCols = percentiles
      .map((p) => {
        const label = 'p' + Math.round(p * 100);
        return `ROUND(percentile_cont(${p}) WITHIN GROUP (ORDER BY ${col})::numeric, 2) AS ${label}`;
      })
      .join(',\n  ');

    const groupBy = input.groupBy?.length ? input.groupBy : null;

    if (!groupBy) {
      return `SELECT
  COUNT(*) AS total_count,
  COUNT(${col}) AS non_null_count,
  COUNT(*) - COUNT(${col}) AS null_count,
  ROUND(100.0 * (COUNT(*) - COUNT(${col})) / NULLIF(COUNT(*), 0)::numeric, 2) AS null_pct,
  MIN(${col})::numeric AS min,
  MAX(${col})::numeric AS max,
  ROUND(AVG(${col})::numeric, 2) AS avg,
  ROUND(STDDEV(${col})::numeric, 2) AS stddev,
  ${pctCols}
FROM ${input.table}
${where}`;
    }

    const dims = groupBy.join(', ');
    return `SELECT
  ${dims},
  COUNT(*) AS total_count,
  COUNT(${col}) AS non_null_count,
  ROUND(100.0 * (COUNT(*) - COUNT(${col})) / NULLIF(COUNT(*), 0)::numeric, 2) AS null_pct,
  MIN(${col})::numeric AS min,
  MAX(${col})::numeric AS max,
  ROUND(AVG(${col})::numeric, 2) AS avg,
  ROUND(STDDEV(${col})::numeric, 2) AS stddev,
  ${pctCols}
FROM ${input.table}
${where}
GROUP BY ${dims}
ORDER BY total_count DESC
LIMIT ${topN}`;
  }
}
