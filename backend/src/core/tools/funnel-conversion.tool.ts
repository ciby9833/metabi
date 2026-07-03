import { Injectable } from '@nestjs/common';
import { SqlSafetyService } from '../sql-engine/sql-safety.service';
import { SqlExecutorService } from '../sql-engine/sql-executor.service';
import { AgentTool, ToolContext, ToolDefinition } from './tool.types';

interface FunnelStep {
  name: string;
  /** 这一步触发条件 SQL，例如 "event_name = 'login'" */
  where: string;
}

interface Input {
  events_table: string;
  user_column: string;
  time_column: string;
  steps: FunnelStep[];
  /** 全局时间过滤 */
  start_date?: string;
  end_date?: string;
}

interface FunnelStepResult {
  step: string;
  users: number;
  conversionFromStart: number; // users / step0.users
  conversionFromPrev: number;  // users / prevStep.users
  dropoffFromPrev: number;     // 1 - conversionFromPrev
}

interface Output {
  ok: boolean;
  steps: FunnelStepResult[];
  totalEntered: number;
  totalCompleted: number;
  overallConversion: number;
  summary: string;
  error?: string;
}

/**
 * 漏斗转化（funnel conversion）
 *
 * MVP：每一步独立计算"满足该步条件的去重用户"，**不强制时序顺序**
 * 工业级会强制 step1 < step2 < step3 时间序，需要 WINDOW 函数，后续可加
 */
@Injectable()
export class FunnelConversionTool implements AgentTool<Input, Output> {
  readonly definition: ToolDefinition = {
    name: 'funnel_conversion',
    description:
      '【漏斗转化分析】按用户标识统计每一步条件命中的去重用户数，算每步转化率和流失率。' +
      '场景：用户问"注册→下单→支付的转化漏斗"、"派送→签收→好评 流失在哪一步"等。' +
      'steps 数组定义每一步的 WHERE 条件。MVP 不强制时序顺序。',
    parameters: {
      type: 'object',
      properties: {
        events_table: { type: 'string', description: '事件表（含 schema）' },
        user_column: { type: 'string', description: '用户/订单标识列' },
        time_column: { type: 'string', description: '时间戳列' },
        steps: {
          type: 'array',
          description: '漏斗各步骤定义',
          items: {
            type: 'object',
            properties: {
              name: { type: 'string', description: '步骤名称' },
              where: { type: 'string', description: 'WHERE 子句（不含 WHERE 关键字）' },
            },
            required: ['name', 'where'],
          },
        },
        start_date: { type: 'string' },
        end_date: { type: 'string' },
      },
      required: ['events_table', 'user_column', 'time_column', 'steps'],
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
    if (input.steps.length < 2) {
      return {
        ok: false,
        steps: [],
        totalEntered: 0,
        totalCompleted: 0,
        overallConversion: 0,
        summary: '',
        error: 'funnel 至少需要 2 步',
      };
    }

    const dateFilter = input.start_date && input.end_date
      ? ` AND ${input.time_column} BETWEEN DATE '${input.start_date}' AND DATE '${input.end_date}'`
      : '';

    try {
      // 一次合并查询：每个 step 一个子 select
      const subQueries = input.steps.map((s, idx) =>
        `SELECT '${idx}' AS step_idx, COUNT(DISTINCT ${input.user_column}) AS users
         FROM ${input.events_table}
         WHERE (${s.where})${dateFilter}`
      ).join('\nUNION ALL\n');

      this.safety.validate(`SELECT 1 FROM ${input.events_table} LIMIT 1`); // 表名安全校验
      // subQueries 整体作为一条 UNION SQL 跑
      const result = await this.executor.execute(subQueries, ctx.datasourceId, {
        userId: ctx.userId,
        conversationId: ctx.conversationId,
      });

      const stepCounts = new Map<number, number>();
      for (const row of result.rows) {
        const idx = parseInt(String(row.step_idx), 10);
        const n = Number(row.users) || 0;
        stepCounts.set(idx, n);
      }

      const totalEntered = stepCounts.get(0) || 0;
      const steps: FunnelStepResult[] = input.steps.map((s, idx) => {
        const users = stepCounts.get(idx) || 0;
        const prev = idx === 0 ? users : stepCounts.get(idx - 1) || 0;
        return {
          step: s.name,
          users,
          conversionFromStart: totalEntered > 0 ? users / totalEntered : 0,
          conversionFromPrev: prev > 0 ? users / prev : 0,
          dropoffFromPrev: prev > 0 ? 1 - users / prev : 0,
        };
      });
      const totalCompleted = steps[steps.length - 1].users;
      const overallConversion = totalEntered > 0 ? totalCompleted / totalEntered : 0;

      return {
        ok: true,
        steps,
        totalEntered,
        totalCompleted,
        overallConversion,
        summary: this.buildSummary(steps, overallConversion),
      };
    } catch (err) {
      return {
        ok: false,
        steps: [],
        totalEntered: 0,
        totalCompleted: 0,
        overallConversion: 0,
        summary: '',
        error: (err as Error).message,
      };
    }
  }

  private buildSummary(steps: FunnelStepResult[], overall: number): string {
    if (steps.length === 0) return '无数据';
    const worst = steps.slice(1).reduce(
      (acc, s) => (s.dropoffFromPrev > acc.dropoffFromPrev ? s : acc),
      steps[1],
    );
    return (
      `总转化率 ${(overall * 100).toFixed(1)}%（${steps[0].users.toLocaleString()} → ${steps[steps.length - 1].users.toLocaleString()}）。` +
      `流失最严重：「${worst.step}」流失 ${(worst.dropoffFromPrev * 100).toFixed(1)}%`
    );
  }
}
