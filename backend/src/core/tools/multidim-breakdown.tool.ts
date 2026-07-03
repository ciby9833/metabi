import { Injectable, Logger } from '@nestjs/common';
import { SqlExecutorService } from '../sql-engine/sql-executor.service';
import { AgentTool, ToolContext, ToolDefinition } from './tool.types';

type MetricKind = 'count' | 'count_distinct' | 'sum' | 'avg' | 'min' | 'max';

interface MetricSpec {
  /** 列名（输出列前缀）*/
  name: string;
  kind: MetricKind;
  /** 字段名；count 时可不传 */
  column?: string;
}

interface BucketSpec {
  label: string;
  /** numeric: 下界（含）*/
  min?: number;
  /** numeric: 上界（不含）*/
  max?: number;
  /** enum: 字段匹配值；不传则等于 label */
  value?: string;
}

interface BucketBy {
  /** 分桶字段 */
  field: string;
  type: 'numeric' | 'enum' | 'date_trunc';
  /**
   * numeric / enum 必填。每项为对象 {label, min?, max?, value?}。
   * 兼容旧用法：如果传进来是 string，自动解析或视作 enum label。
   */
  buckets?: BucketSpec[] | string[];
  /** date_trunc: 时间粒度 */
  dateGranularity?: 'day' | 'week' | 'month' | 'quarter' | 'year';
}

/** 把 LLM 可能传的 string / object 统一规整成 BucketSpec[] */
function normalizeBuckets(raw: any[] | undefined, type: BucketBy['type']): BucketSpec[] {
  if (!raw?.length) return [];
  return raw.map((b, i) => {
    // 已是对象
    if (typeof b === 'object' && b !== null && !Array.isArray(b)) return b as BucketSpec;
    // 是字符串：尝试 JSON 解析；解析失败则视作 enum label
    if (typeof b === 'string') {
      const trimmed = b.trim();
      if (trimmed.startsWith('{')) {
        try {
          return JSON.parse(trimmed) as BucketSpec;
        } catch {
          // fallthrough
        }
      }
      // 普通字符串 → enum 用
      if (type === 'enum') return { label: trimmed, value: trimmed };
      throw new Error(`bucket[${i}] 是字符串但 type=${type}，请改成 {label,min?,max?} 对象`);
    }
    throw new Error(`bucket[${i}] 类型不支持`);
  });
}

interface Input {
  /** 完整表名（如 dwd.waybill_detail）*/
  table: string;
  /** WHERE 子句（不含 WHERE 关键字）*/
  where?: string;
  /** 行维度（1-3 个）*/
  groupBy: string[];
  /** 列维度（可选）— 自动 PIVOT 把同一桶变成列 */
  bucketBy?: BucketBy;
  /** 指标列表（1+）*/
  metrics: MetricSpec[];
  /** 自动追加"占总量百分比"列（基于第一个 metric）*/
  includePctOfTotal?: boolean;
  /** 自动追加日均列（除以 windowDays；基于第一个 metric）*/
  windowDays?: number;
  /** 按哪个 metric 排序，默认第一个 */
  orderByMetric?: string;
  /** 排序方向，默认 DESC */
  orderDir?: 'ASC' | 'DESC';
  /** 行数上限，默认 50；最大 200 */
  topN?: number;
  /** 是否过滤 groupBy 字段的 NULL（默认 true）*/
  excludeNullDimensions?: boolean;
}

interface Output {
  ok: boolean;
  /** 实际执行的 SQL（让用户能审计 + 报告引用）*/
  generatedSql: string;
  columns?: { name: string; type: string }[];
  rows?: Record<string, any>[];
  rowCount?: number;
  /** 一句话总结，给 LLM 写 finalize.narrative 用 */
  summary?: string;
  /** 错误时给的回退建议 */
  hint?: string;
  error?: string;
}

const IDENTIFIER_RE = /^[a-zA-Z_][\w]*(\.[a-zA-Z_][\w]*)?$/;

/**
 * multidim_breakdown
 *
 * 多维交叉聚合工具。专治"按 X、Y 看 metric A、metric B、占比、日均"这类问题。
 * 工具内部统一拼 CTE + 窗口函数，**保证口径一致**：
 *   - 占比的分子分母都用同一个聚合（避免 LLM 写 COUNT(DISTINCT) vs SUM(CASE WHEN ...) 混用）
 *   - 自动 NULLIF 防 0 除
 *   - 自动排除 groupBy 为 NULL 的脏行
 *   - bucketBy 自动 PIVOT 成列
 *
 * 适用场景：
 *   ✅ 流向分布：origin × destination + 单量 + 公斤段占比 + 日均
 *   ✅ TopN 客户 + 各品类占比
 *   ✅ 按时段（按月分桶）× 网点 看签收量
 *   ❌ 含子查询 / JOIN 多表 / 复杂窗口 → 用 run_sql 自己写
 *   ❌ 单维归因找贡献最大维 → 用 decompose_by_dimensions
 *   ❌ 时间对比（同环比）→ 用 compare_periods
 */
@Injectable()
export class MultidimBreakdownTool implements AgentTool<Input, Output> {
  private readonly logger = new Logger(MultidimBreakdownTool.name);

  readonly definition: ToolDefinition = {
    name: 'multidim_breakdown',
    description:
      '多维交叉聚合：按多个维度 GROUP BY + 多个聚合 metric + 可选分桶 PIVOT + 自动占比/日均。\n' +
      '✅ 使用场景：「流向分布」「TopN × 各类目占比」「按时段 × 网点 看 metric」「按公斤段看流向单量」等多维分布问题。\n' +
      '❌ 不要用于：单维归因（用 decompose_by_dimensions）、时间对比（用 compare_periods）、复杂 JOIN（用 run_sql）。\n' +
      '工具自动保证占比、日均、NULL、0 除等口径一致；比自己写 SQL 不容易出 Reviewer 挑的口径错。',
    parameters: {
      type: 'object',
      properties: {
        table: { type: 'string', description: '完整表名，如 dwd.waybill_detail' },
        where: {
          type: 'string',
          description: 'WHERE 子句（不含 WHERE 关键字），如 "shipping_time >= \'2026-06-01\'"',
        },
        groupBy: {
          type: 'array',
          items: { type: 'string' },
          description: '行维度字段（1-3 个），如 ["origin_city","destination_city"]',
        },
        bucketBy: {
          type: 'object',
          description: '可选：把指定字段按桶横铺成列。工具会自动 PIVOT。',
          properties: {
            field: { type: 'string' },
            type: { type: 'string', enum: ['numeric', 'enum', 'date_trunc'] },
            buckets: {
              type: 'array',
              description:
                'numeric 类型时每项是对象 {label, min?, max?}（如 {"label":"0-1kg","max":1}）；' +
                'enum 类型时直接是 label 列表里嵌入 {label} 对象，或简单字符串数组也接受。',
              items: {
                type: 'object',
                properties: {
                  label: { type: 'string', description: 'numeric / enum 必填' },
                  min: { type: 'number', description: 'numeric 类型用，下界（含）' },
                  max: { type: 'number', description: 'numeric 类型用，上界（不含）' },
                  value: { type: 'string', description: 'enum 类型用，匹配字段值；不传默认等于 label' },
                },
                required: ['label'],
                additionalProperties: false,
              },
            },
            dateGranularity: {
              type: 'string',
              enum: ['day', 'week', 'month', 'quarter', 'year'],
            },
          },
          required: ['field', 'type'],
        },
        metrics: {
          type: 'array',
          description: '聚合 metric 列表（1+）',
          items: {
            type: 'object',
            properties: {
              name: { type: 'string', description: '输出列名前缀，如 order_count' },
              kind: {
                type: 'string',
                enum: ['count', 'count_distinct', 'sum', 'avg', 'min', 'max'],
              },
              column: { type: 'string', description: 'kind != count 时必填' },
            },
            required: ['name', 'kind'],
          },
        },
        includePctOfTotal: {
          type: 'boolean',
          description: '自动加"占总量百分比"列（基于第一个 metric）。默认 false',
        },
        windowDays: {
          type: 'number',
          description:
            '⚠️ 这是"时间窗的天数"（不是小时数）。如：6 月数据 → 30，最近一周 → 7，2 个月 → 60。' +
            '工具会用 metric / windowDays 算"日均"列。**不要传 24**（24 是小时，不是天）。',
        },
        orderByMetric: { type: 'string', description: '按哪个 metric.name 排序，默认第一个' },
        orderDir: { type: 'string', enum: ['ASC', 'DESC'] },
        topN: { type: 'number', description: '行数上限，默认 50，最大 200' },
        excludeNullDimensions: { type: 'boolean', description: '默认 true：排除 groupBy 为 NULL 的行' },
      },
      required: ['table', 'groupBy', 'metrics'],
      additionalProperties: false,
    },
    // 企业 datasource 专用：基于业务 metric/SQL 模板的计算工具，不适合用户上传的小型 dataset
    availability: 'enterprise_only',
  };

  constructor(private readonly executor: SqlExecutorService) {}

  async execute(input: Input, ctx: ToolContext): Promise<Output> {
    try {
      this.validateInputs(input);
    } catch (err) {
      return {
        ok: false,
        generatedSql: '',
        error: (err as Error).message,
        hint: '请修正参数后重试，或改用 run_sql 自己写 SQL。',
      };
    }

    const topN = Math.min(Math.max(input.topN || 50, 1), 200);
    const orderDir = input.orderDir === 'ASC' ? 'ASC' : 'DESC';
    const orderByMetric = input.orderByMetric || input.metrics[0].name;
    if (!input.metrics.find((m) => m.name === orderByMetric)) {
      return {
        ok: false,
        generatedSql: '',
        error: `orderByMetric "${orderByMetric}" 不在 metrics 列表里`,
        hint: '请用 metrics[*].name 之一作为 orderByMetric。',
      };
    }

    const sql = this.buildSql(input, topN, orderByMetric, orderDir);

    try {
      const result = await this.executor.execute(sql, ctx.datasourceId, {
        conversationId: ctx.conversationId,
        userId: ctx.userId,
      });

      // 工具产生的结果也算一次"真跑"
      ctx.successfulSqlRuns = (ctx.successfulSqlRuns || 0) + 1;

      return {
        ok: true,
        generatedSql: sql,
        columns: result.columns,
        rows: result.rows,
        rowCount: result.rowCount,
        summary: this.buildSummary(input, result.rowCount, topN),
      };
    } catch (err) {
      return {
        ok: false,
        generatedSql: sql,
        error: (err as Error).message,
        hint: '工具拼出的 SQL 执行失败。可能是 where / 字段名错。建议改用 run_sql 自己调。',
      };
    }
  }

  // ============== validators ==============

  private validateInputs(input: Input) {
    if (!input.table || !IDENTIFIER_RE.test(input.table)) {
      throw new Error(`table "${input.table}" 不是合法表名（仅支持 schema.table）`);
    }
    if (!input.groupBy?.length || input.groupBy.length > 3) {
      throw new Error('groupBy 必须传 1-3 个字段');
    }
    for (const c of input.groupBy) {
      if (!IDENTIFIER_RE.test(c)) throw new Error(`groupBy 字段名非法: ${c}`);
    }
    if (!input.metrics?.length || input.metrics.length > 10) {
      throw new Error('metrics 必须传 1-10 个');
    }
    const seenNames = new Set<string>();
    for (const m of input.metrics) {
      if (!m.name || !/^[a-zA-Z_][\w]*$/.test(m.name)) {
        throw new Error(`metric.name 非法: ${m.name}（仅字母数字下划线）`);
      }
      if (seenNames.has(m.name)) throw new Error(`metric.name 重复: ${m.name}`);
      seenNames.add(m.name);
      if (m.kind !== 'count' && !m.column) {
        throw new Error(`metric "${m.name}" 是 ${m.kind}，必须传 column`);
      }
      if (m.column && !IDENTIFIER_RE.test(m.column)) {
        throw new Error(`metric "${m.name}".column 非法: ${m.column}`);
      }
    }
    if (input.bucketBy) {
      const b = input.bucketBy;
      if (!IDENTIFIER_RE.test(b.field)) throw new Error(`bucketBy.field 非法: ${b.field}`);
      if (b.type === 'numeric' || b.type === 'enum') {
        if (!b.buckets?.length) throw new Error(`bucketBy type=${b.type} 时必须传 buckets`);
        if (b.buckets.length > 20) throw new Error('buckets 最多 20 个');
        // 归一化（兼容 LLM 传 string）+ label 校验
        const normalized = normalizeBuckets(b.buckets as any, b.type);
        for (const bk of normalized) {
          if (!bk.label || typeof bk.label !== 'string') {
            throw new Error('每个 bucket 必须有 label 字段');
          }
        }
        // 写回 normalized，后续 buildSql 直接用
        (b as any).buckets = normalized;
      }
    }
  }

  // ============== SQL builder ==============

  private buildSql(
    input: Input,
    topN: number,
    orderByMetric: string,
    orderDir: 'ASC' | 'DESC',
  ): string {
    const groupBy = input.groupBy;
    const where = this.composeWhere(input);
    const baseTable = input.table;
    const bucket = input.bucketBy;

    // metric → SQL 表达式（保持 LLM 可读，且单一来源）
    const metricExpr = (m: MetricSpec): string => {
      switch (m.kind) {
        case 'count':
          return `COUNT(*)`;
        case 'count_distinct':
          return `COUNT(DISTINCT ${m.column})`;
        case 'sum':
          return `SUM(${m.column})`;
        case 'avg':
          return `AVG(${m.column})`;
        case 'min':
          return `MIN(${m.column})`;
        case 'max':
          return `MAX(${m.column})`;
      }
    };

    const dims = groupBy.join(', ');
    const dimsSelectAs = groupBy.map((g) => `t.${g}`).join(', ');

    if (!bucket) {
      // —— 无 PIVOT 路径 ——
      const metricSel = input.metrics
        .map((m) => `${metricExpr(m)} AS ${m.name}`)
        .join(',\n  ');

      const extras: string[] = [];
      if (input.includePctOfTotal) {
        // 占比基于第一个 metric
        const m0 = input.metrics[0];
        const numerator = metricExpr(m0);
        extras.push(
          `ROUND(100.0 * ${numerator} / NULLIF(SUM(${numerator}) OVER (), 0), 2) AS pct_of_total`,
        );
      }
      if (input.windowDays && input.windowDays > 0) {
        const m0 = input.metrics[0];
        extras.push(
          `ROUND(${metricExpr(m0)} / ${input.windowDays}.0, 2) AS avg_per_day`,
        );
      }
      const extraSel = extras.length ? ',\n  ' + extras.join(',\n  ') : '';

      return `WITH agg AS (
  SELECT
    ${dims},
    ${metricSel}${extraSel}
  FROM ${baseTable}
  ${where}
  GROUP BY ${dims}
)
SELECT * FROM agg
ORDER BY ${orderByMetric} ${orderDir}
LIMIT ${topN}`;
    }

    // —— PIVOT 路径 —— bucketBy 把列横过来
    const bucketExpr = this.buildBucketExpr(bucket);
    // 桶 label → 列名（清洗一下避免特殊字符）
    const bucketLabels: string[] = this.buildBucketLabels(bucket);
    const sanitize = (s: string) => s.replace(/[^a-zA-Z0-9_]/g, '_').toLowerCase();

    // 每个 metric × 每个 bucket → 一列
    const pivotCols: string[] = [];
    for (const m of input.metrics) {
      for (const label of bucketLabels) {
        const colName = `${m.name}_${sanitize(label)}`;
        const baseExpr = m.kind === 'count'
          ? `COUNT(*) FILTER (WHERE bk = '${label.replace(/'/g, "''")}')`
          : m.kind === 'count_distinct'
          ? `COUNT(DISTINCT CASE WHEN bk = '${label.replace(/'/g, "''")}' THEN ${m.column} END)`
          : m.kind === 'sum'
          ? `SUM(${m.column}) FILTER (WHERE bk = '${label.replace(/'/g, "''")}')`
          : m.kind === 'avg'
          ? `AVG(${m.column}) FILTER (WHERE bk = '${label.replace(/'/g, "''")}')`
          : m.kind === 'min'
          ? `MIN(${m.column}) FILTER (WHERE bk = '${label.replace(/'/g, "''")}')`
          : `MAX(${m.column}) FILTER (WHERE bk = '${label.replace(/'/g, "''")}')`;
        pivotCols.push(`${baseExpr} AS ${colName}`);
      }
    }

    // 主 metric 总量（用于排序 + 占比 + 日均）
    const m0 = input.metrics[0];
    const totalExpr = metricExpr(m0);
    const totalSelect = `${totalExpr} AS ${m0.name}_total`;
    const orderColumn = `${m0.name}_total`;

    const extras: string[] = [];
    if (input.includePctOfTotal) {
      extras.push(
        `ROUND(100.0 * ${totalExpr} / NULLIF(SUM(${totalExpr}) OVER (), 0), 2) AS pct_of_total`,
      );
    }
    if (input.windowDays && input.windowDays > 0) {
      extras.push(`ROUND(${totalExpr} / ${input.windowDays}.0, 2) AS avg_per_day`);
    }
    const extraSel = extras.length ? ',\n  ' + extras.join(',\n  ') : '';

    // 收集 metric 用到的字段（去重），CTE 只 SELECT 这些避免 *
    const metricColumns = new Set<string>();
    for (const m of input.metrics) {
      if (m.column) metricColumns.add(m.column);
    }
    // bucketBy 的 field 也要带进 CTE（构造 bk 需要）
    const carryCols = Array.from(metricColumns)
      .filter((c) => !groupBy.includes(c)) // 避免跟 dim 重名导致 ambiguous
      .join(', ');

    return `WITH bucketed AS (
  SELECT
    ${dims},
    ${bucketExpr} AS bk${carryCols ? ',\n    ' + carryCols : ''}
  FROM ${baseTable}
  ${where}
),
agg AS (
  SELECT
    ${dims},
    ${totalSelect},
    ${pivotCols.join(',\n    ')}${extraSel}
  FROM bucketed
  WHERE bk IS NOT NULL
  GROUP BY ${dims}
)
SELECT * FROM agg
ORDER BY ${input.orderByMetric === orderByMetric ? orderColumn : orderColumn} ${orderDir}
LIMIT ${topN}`;
  }

  private composeWhere(input: Input): string {
    const clauses: string[] = [];
    if (input.where?.trim()) clauses.push(`(${input.where.trim()})`);
    if (input.excludeNullDimensions !== false) {
      for (const g of input.groupBy) clauses.push(`${g} IS NOT NULL`);
    }
    return clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  }

  private buildBucketExpr(b: BucketBy): string {
    if (b.type === 'enum') {
      // 用 BucketSpec 形式：每个桶有 label（结果列名）+ value（字段实际值，缺省=label）
      const cases = (b.buckets as BucketSpec[])
        .map((bk) => {
          const v = bk.value ?? bk.label;
          return `WHEN ${b.field} = '${v.replace(/'/g, "''")}' THEN '${bk.label.replace(/'/g, "''")}'`;
        })
        .join('\n      ');
      return `CASE\n      ${cases}\n      ELSE NULL\n    END`;
    }
    if (b.type === 'date_trunc') {
      const g = b.dateGranularity || 'day';
      return `DATE_TRUNC('${g}', ${b.field})::text`;
    }
    // numeric
    const cases = (b.buckets as BucketSpec[])
      .map((bk) => {
        const conds: string[] = [];
        if (bk.min !== undefined) conds.push(`${b.field} >= ${bk.min}`);
        if (bk.max !== undefined) conds.push(`${b.field} < ${bk.max}`);
        const cond = conds.length ? conds.join(' AND ') : 'TRUE';
        return `WHEN ${cond} THEN '${bk.label.replace(/'/g, "''")}'`;
      })
      .join('\n      ');
    return `CASE\n      ${cases}\n      ELSE NULL\n    END`;
  }

  private buildBucketLabels(b: BucketBy): string[] {
    if (b.type === 'enum' || b.type === 'numeric') {
      return (b.buckets as BucketSpec[]).map((bk) => bk.label);
    }
    // date_trunc 桶是动态的 — 暂时不支持 PIVOT（建议改回 groupBy）
    throw new Error(
      'date_trunc 类型不能直接 PIVOT（桶数量动态）。请把时间字段放 groupBy，不用 bucketBy。',
    );
  }

  private buildSummary(input: Input, rowCount: number, topN: number): string {
    const dimsTxt = input.groupBy.join(' × ');
    const metricsTxt = input.metrics.map((m) => m.name).join(', ');
    const bucketTxt = input.bucketBy
      ? `，按 ${input.bucketBy.field} 分 ${this.buildBucketLabels(input.bucketBy).length} 桶 PIVOT`
      : '';
    const limited = rowCount >= topN ? `（已限 Top ${topN}）` : '';
    const extras = [
      input.includePctOfTotal ? '含占比' : null,
      input.windowDays ? '含日均' : null,
    ]
      .filter(Boolean)
      .join('、');
    return `已对 ${dimsTxt} 多维拆解${bucketTxt}，输出 ${rowCount} 行 × metric: ${metricsTxt}${extras ? '（' + extras + '）' : ''}${limited}`;
  }
}
