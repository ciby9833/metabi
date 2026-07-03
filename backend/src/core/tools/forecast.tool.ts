import { Injectable } from '@nestjs/common';
import { SqlSafetyService } from '../sql-engine/sql-safety.service';
import { SqlExecutorService } from '../sql-engine/sql-executor.service';
import { AgentTool, ToolContext, ToolDefinition } from './tool.types';

interface Input {
  /** 用于拿历史时间序列的 SQL（必须返回 [date, value] 两列）*/
  history_sql: string;
  /** 预测未来多少个点 */
  periods_ahead?: number;
  /** 算法：moving_avg（默认）/ linear */
  method?: 'moving_avg' | 'linear';
  /** moving_avg 的窗口大小 */
  ma_window?: number;
}

interface ForecastPoint {
  index: number; // 0..periods_ahead-1
  forecast: number;
  /** 历史均值（仅 moving_avg）*/
  basis?: number;
}

interface Output {
  ok: boolean;
  method: string;
  history: { date: string; value: number }[];
  forecast: ForecastPoint[];
  summary: string;
  error?: string;
}

/**
 * 简单预测 MVP
 * - moving_avg: 用最近 N 个点平均值预测后续
 * - linear: 最小二乘拟合线性趋势
 *
 * 工业级（ARIMA / Prophet / LSTM）需要 Python 服务，这里不做
 */
@Injectable()
export class ForecastTool implements AgentTool<Input, Output> {
  readonly definition: ToolDefinition = {
    name: 'forecast',
    description:
      '【时序预测 MVP】基于历史数据预测未来 N 个点。提供两种方法：移动平均（稳定）/ 线性回归（有趋势）。' +
      '注意：仅适合短期粗略预测，工业级预测请用专用工具。' +
      'history_sql 必须返回两列：date (时间) + value (数值)。',
    parameters: {
      type: 'object',
      properties: {
        history_sql: { type: 'string', description: '取历史数据的 SELECT 语句，需返回 date, value 两列' },
        periods_ahead: { type: 'integer', minimum: 1, maximum: 30, description: '预测多少期，默认 7' },
        method: {
          type: 'string',
          enum: ['moving_avg', 'linear'],
          description: '默认 moving_avg',
        },
        ma_window: { type: 'integer', minimum: 2, maximum: 30, description: '移动平均窗口，默认 7' },
      },
      required: ['history_sql'],
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
    const periods = Math.min(input.periods_ahead || 7, 30);
    const method = input.method || 'moving_avg';
    const window = Math.min(input.ma_window || 7, 30);

    try {
      this.safety.validate(input.history_sql);
      const result = await this.executor.execute(input.history_sql, ctx.datasourceId, {
        userId: ctx.userId,
        conversationId: ctx.conversationId,
      });
      if (result.rowCount < 3) {
        return {
          ok: false,
          method,
          history: [],
          forecast: [],
          summary: '',
          error: `历史数据不足（仅 ${result.rowCount} 行），无法预测`,
        };
      }
      const history = result.rows.map((r) => ({
        date: String(r.date ?? r['date'] ?? Object.values(r)[0]),
        value: Number(r.value ?? r['value'] ?? Object.values(r)[1]) || 0,
      }));

      const forecast =
        method === 'linear'
          ? this.forecastLinear(history, periods)
          : this.forecastMovingAvg(history, periods, window);

      return {
        ok: true,
        method,
        history,
        forecast,
        summary: this.buildSummary(history, forecast, method),
      };
    } catch (err) {
      return {
        ok: false,
        method,
        history: [],
        forecast: [],
        summary: '',
        error: (err as Error).message,
      };
    }
  }

  /** 滑动窗口均值预测 */
  private forecastMovingAvg(
    history: { date: string; value: number }[],
    periods: number,
    window: number,
  ): ForecastPoint[] {
    const w = Math.min(window, history.length);
    const lastN = history.slice(-w).map((p) => p.value);
    const avg = lastN.reduce((s, v) => s + v, 0) / w;
    return Array.from({ length: periods }, (_, i) => ({
      index: i,
      forecast: avg,
      basis: avg,
    }));
  }

  /** 最小二乘线性拟合 */
  private forecastLinear(
    history: { date: string; value: number }[],
    periods: number,
  ): ForecastPoint[] {
    const n = history.length;
    let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0;
    history.forEach((p, i) => {
      sumX += i;
      sumY += p.value;
      sumXY += i * p.value;
      sumX2 += i * i;
    });
    const denom = n * sumX2 - sumX * sumX;
    const slope = denom !== 0 ? (n * sumXY - sumX * sumY) / denom : 0;
    const intercept = (sumY - slope * sumX) / n;
    return Array.from({ length: periods }, (_, i) => ({
      index: i,
      forecast: intercept + slope * (n + i),
    }));
  }

  private buildSummary(
    history: { date: string; value: number }[],
    forecast: ForecastPoint[],
    method: string,
  ): string {
    if (forecast.length === 0) return '无预测';
    const first = forecast[0].forecast;
    const last = forecast[forecast.length - 1].forecast;
    const lastHist = history[history.length - 1].value;
    const dir = last > lastHist ? '继续上升' : last < lastHist ? '下降' : '保持平稳';
    return (
      `基于 ${history.length} 个历史点，用 ${method} 方法预测未来 ${forecast.length} 个点：` +
      `预测均值 ${this.fmt((first + last) / 2)}，趋势${dir}（最后历史值 ${this.fmt(lastHist)} → 末次预测 ${this.fmt(last)}）`
    );
  }

  private fmt(v: number): string {
    if (Math.abs(v) >= 10000) return `${(v / 10000).toFixed(1)}万`;
    if (Math.abs(v) >= 1000) return v.toFixed(0);
    return v.toFixed(1);
  }
}
