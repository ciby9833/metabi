import { Injectable } from '@nestjs/common';
import { SqlExecutorService } from '../sql-engine/sql-executor.service';
import { SqlSafetyService } from '../sql-engine/sql-safety.service';
import { AgentTool, ToolContext, ToolDefinition } from './tool.types';

interface Input {
  sql: string;
  /** dry_run=true：仅校验语法 & 安全，不真跑 */
  dry_run?: boolean;
}
interface Output {
  ok: boolean;
  dryRun: boolean;
  rowCount?: number;
  columns?: { name: string; type: string }[];
  rows?: Record<string, any>[];
  truncated?: boolean;
  executionTimeMs?: number;
  fromCache?: boolean;
  error?: string;
}

/** dry_run 上限（只校验语法，不消耗 DB；给宽点防死循环）*/
const MAX_DRY_RUNS_PER_SESSION = 15;
/** 真跑上限（含成功/失败）。复杂分析常需要 3-5 次（先总览，再按维度拆，再交叉）*/
const MAX_REAL_RUNS_PER_SESSION = 5;

@Injectable()
export class RunSqlTool implements AgentTool<Input, Output> {
  readonly definition: ToolDefinition = {
    name: 'run_sql',
    description:
      '执行只读 SQL 查询。建议先用 dry_run=true 验语法，再 dry_run=false 真跑。每次会话最多 8 次。',
    parameters: {
      type: 'object',
      properties: {
        sql: { type: 'string', description: '只读 SQL（SELECT / WITH），禁止任何修改性语句' },
        dry_run: {
          type: 'boolean',
          description: 'true=仅校验语法&安全，不执行；false=真跑（默认）',
        },
      },
      required: ['sql'],
      additionalProperties: false,
    },
  };

  constructor(
    private readonly safety: SqlSafetyService,
    private readonly executor: SqlExecutorService,
  ) {}

  /** 从 SQL 抽出 FROM/JOIN 的表名（schema.table 或裸 table） */
  private extractTablesFromSql(sql: string): string[] {
    const out: string[] = [];
    const regex = /\b(?:FROM|JOIN)\s+([a-zA-Z_][\w]*(?:\.[a-zA-Z_][\w]*)?)/gi;
    let m: RegExpExecArray | null;
    while ((m = regex.exec(sql)) !== null) {
      out.push(m[1]);
    }
    return Array.from(new Set(out));
  }

  /**
   * 抽出 WITH 子句里定义的 CTE 名（这些不是真表，不应被白名单拦截）
   *   WITH a AS (...), b AS (...) SELECT ... → ['a', 'b']
   *   WITH RECURSIVE a AS (...) SELECT ... → ['a']
   * 简化策略：捕获 (^|,) + 标识符 + AS + (
   */
  private extractCteNames(sql: string): Set<string> {
    const out = new Set<string>();
    // 只看 WITH 关键字到第一个独立 SELECT 之间（粗略，但实战足够）
    const withMatch = sql.match(/\bWITH\s+(RECURSIVE\s+)?([\s\S]+)/i);
    if (!withMatch) return out;
    const tail = withMatch[2];
    const cteRegex = /(?:^|,|\))\s*([a-zA-Z_][\w]*)\s+AS\s*\(/gi;
    let cm: RegExpExecArray | null;
    while ((cm = cteRegex.exec(tail)) !== null) {
      out.add(cm[1].toLowerCase());
    }
    return out;
  }

  async execute(input: Input, ctx: ToolContext): Promise<Output> {
    // 1) 限流：dry_run 和真跑独立计数
    if (input.dry_run) {
      ctx.dryRunCount = (ctx.dryRunCount || 0) + 1;
      if (ctx.dryRunCount > MAX_DRY_RUNS_PER_SESSION) {
        return {
          ok: false,
          dryRun: true,
          error: `❌ dry_run 校验次数过多 (${MAX_DRY_RUNS_PER_SESSION})。请检查 SQL 是否有反复改不通的问题，或调用 finalize 结束。`,
        };
      }
    } else {
      ctx.successfulSqlRuns = (ctx.successfulSqlRuns || 0);
      if (ctx.successfulSqlRuns >= MAX_REAL_RUNS_PER_SESSION) {
        return {
          ok: false,
          dryRun: false,
          error: `❌ 已达真跑 SQL 上限 (${MAX_REAL_RUNS_PER_SESSION})。**请立刻调用 finalize 工具**结束，把目前最好的 SQL 和结果交给 Reviewer。`,
        };
      }
    }

    // 3) 安全校验
    try {
      this.safety.validate(input.sql);
    } catch (err) {
      return {
        ok: false,
        dryRun: !!input.dry_run,
        error: `SQL 安全校验失败: ${(err as Error).message}`,
      };
    }

    // 3b) Skill 白名单校验：SQL 涉及的表必须在 ctx.allowedTables 内
    //     - WITH cte AS (...) 里定义的 CTE 名跳过校验（不是真表）
    //     - 子查询的别名同样不会被 extractTablesFromSql 捕获到，无需特殊处理
    //     - 双向匹配：SQL 用 dwd.x / 白名单用 x 互相兼容
    if (ctx.allowedTables && ctx.allowedTables.length > 0) {
      const used = this.extractTablesFromSql(input.sql);
      const cteNames = this.extractCteNames(input.sql);
      const allowedFull = new Set(ctx.allowedTables.map((t) => t.toLowerCase()));
      const allowedBare = new Set(
        ctx.allowedTables.map((t) => (t.includes('.') ? t.split('.')[1] : t).toLowerCase()),
      );
      const violating = used.filter((t) => {
        const lower = t.toLowerCase();
        const bare = t.includes('.') ? t.split('.')[1].toLowerCase() : lower;
        // 是 CTE 名（裸名匹配）→ 跳过
        if (cteNames.has(bare)) return false;
        return !allowedFull.has(lower) && !allowedBare.has(bare);
      });
      if (violating.length > 0) {
        return {
          ok: false,
          dryRun: !!input.dry_run,
          error:
            `❌ 当前 Skill 不允许访问这些表：${violating.join(', ')}。\n` +
            `可用表（请用完整 schema.table 格式）：${ctx.allowedTables.join(', ')}\n` +
            `示例：SELECT ... FROM ${ctx.allowedTables[0]} ...\n` +
            `提示：WITH x AS (...) 里定义的 CTE 名不会被拦截，可放心用 CTE 做多步聚合。`,
        };
      }
    }

    // 4) dry-run 只校验，不执行
    if (input.dry_run) {
      return { ok: true, dryRun: true };
    }

    // 5) 真跑
    try {
      const result = await this.executor.execute(input.sql, ctx.datasourceId, {
        conversationId: ctx.conversationId,
        userId: ctx.userId,
      });
      ctx.successfulSqlRuns = (ctx.successfulSqlRuns || 0) + 1;
      return {
        ok: true,
        dryRun: false,
        rowCount: result.rowCount,
        columns: result.columns,
        rows: result.rows,
        truncated: result.truncated,
        executionTimeMs: result.executionTimeMs,
        fromCache: result.fromCache,
        // @ts-expect-error 临时提示字段，前端不展示
        _hint:
          ctx.successfulSqlRuns === 1
            ? '✅ SQL 执行成功。如果结果符合 Skill 业务定义，请立即调用 finalize。'
            : `⚠️ 这是第 ${ctx.successfulSqlRuns} 次真跑。最多再允许 ${MAX_REAL_RUNS_PER_SESSION - ctx.successfulSqlRuns} 次后强制 finalize。`,
      };
    } catch (err) {
      return {
        ok: false,
        dryRun: false,
        error: (err as Error).message,
      };
    }
  }
}
