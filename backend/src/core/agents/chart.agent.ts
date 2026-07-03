import { Injectable, Logger } from '@nestjs/common';
import { QueryResult, ColumnInfo } from '../../providers/connector/types';

export interface ChartConfig {
  type: 'line' | 'bar' | 'pie' | 'table' | 'scatter' | 'heatmap';
  /** ECharts option (when type !== 'table') */
  option?: Record<string, any>;
  /** Table data (when type === 'table') */
  table?: {
    columns: { title: string; dataIndex: string; key: string }[];
    rows: Record<string, any>[];
  };
  /** 选这个图表类型的原因（debug / 前端 tooltip 用）*/
  reason?: string;
}

/**
 * Chart Agent v2
 *
 * 改进点：
 *  - 不再无脑"时间序列 → 折线"
 *  - 列形态分类后给候选图表 + 评分，挑分最高的
 *  - LLM hint 只是候选之一，会被数据形态校验
 *  - 解释为什么选这个图
 */

interface ColumnShape {
  col: ColumnInfo;
  kind: 'time' | 'numeric' | 'string' | 'boolean' | 'unknown';
  /** 去重值数（采样估算） */
  distinctCount: number;
  /** 是否大概率是 ID 类（高基数字符串）*/
  isHighCardinality: boolean;
}

interface DataShape {
  rowCount: number;
  columns: ColumnShape[];
  timeCols: ColumnShape[];
  numericCols: ColumnShape[];
  categoryCols: ColumnShape[];
}

@Injectable()
export class ChartAgent {
  private readonly logger = new Logger(ChartAgent.name);

  build(result: QueryResult, hint = 'auto'): ChartConfig {
    if (!result || result.rowCount === 0) {
      return { ...this.buildTable(result), reason: '无数据，回退表格' };
    }

    const shape = this.analyzeShape(result);
    const lower = (hint || 'auto').toLowerCase();

    // 1) hint 是明确类型 → 验证可行
    if (lower !== 'auto') {
      const honored = this.honorHint(lower, result, shape);
      if (honored) return honored;
      this.logger.debug(`Hint '${hint}' not feasible for this data shape; auto-selecting`);
    }

    // 2) 启发式打分挑最优
    const candidates = this.scoreCandidates(result, shape);
    candidates.sort((a, b) => b.score - a.score);
    const winner = candidates[0];
    this.logger.debug(
      `Chart selection: ${candidates.map((c) => `${c.type}(${c.score})`).join(', ')} → ${winner.type}`,
    );
    return this.render(winner.type, result, shape, winner.reason);
  }

  // ============== Hint 优先 ==============
  private honorHint(hint: string, result: QueryResult, shape: DataShape): ChartConfig | null {
    switch (hint) {
      case 'table':
        return { ...this.buildTable(result), reason: 'LLM 指定 table' };
      case 'line':
        if (shape.timeCols.length > 0 && shape.numericCols.length > 0) {
          return this.buildLineChart(result, shape, 'LLM 指定 line 且数据有时间+数值');
        }
        return null;
      case 'bar':
        if (shape.numericCols.length > 0 && shape.rowCount <= 50) {
          return this.buildBarChart(result, shape, 'LLM 指定 bar');
        }
        return null;
      case 'pie':
        if (shape.numericCols.length === 1 && shape.rowCount <= 8) {
          return this.buildPieChart(result, shape, 'LLM 指定 pie');
        }
        return null;
      case 'scatter':
        if (shape.numericCols.length >= 2) {
          return this.buildScatterChart(result, shape, 'LLM 指定 scatter');
        }
        return null;
      case 'heatmap':
        if (shape.categoryCols.length >= 2 && shape.numericCols.length >= 1) {
          return this.buildHeatmap(result, shape, 'LLM 指定 heatmap');
        }
        return null;
      default:
        return null;
    }
  }

  // ============== 启发式打分 ==============
  private scoreCandidates(
    result: QueryResult,
    shape: DataShape,
  ): { type: ChartConfig['type']; score: number; reason: string }[] {
    const out: { type: ChartConfig['type']; score: number; reason: string }[] = [];
    const { rowCount, timeCols, numericCols, categoryCols } = shape;

    // table: 多列混合 / 高基数 / 高列数 时优先
    let tableScore = 0;
    if (result.columns.length > 5) tableScore += 30;
    if (rowCount > 50) tableScore += 25;
    if (numericCols.length === 0) tableScore += 40;
    if (categoryCols.some((c) => c.isHighCardinality)) tableScore += 20;
    tableScore += 10; // 始终有备胎价值
    out.push({ type: 'table', score: tableScore, reason: '默认安全选项' });

    // line: 第一列是时间 + 至少 1 个数值 + 至少 3 行
    if (timeCols.length > 0 && numericCols.length > 0 && rowCount >= 3) {
      let s = 70;
      if (rowCount <= 200) s += 10;
      if (numericCols.length === 1) s += 5;
      else if (numericCols.length <= 4) s += 10; // 多指标更适合折线
      out.push({
        type: 'line',
        score: s,
        reason: `时间序列 (${rowCount} 时间点 × ${numericCols.length} 指标)`,
      });
    }

    // bar: 分类 + 1-3 个数值 + 行数适中
    if (categoryCols.length >= 1 && numericCols.length >= 1 && rowCount <= 30) {
      let s = 60;
      if (rowCount <= 15) s += 15;
      if (timeCols.length === 0) s += 10; // 没时间字段才优先用柱
      if (numericCols.length === 1) s += 5;
      out.push({
        type: 'bar',
        score: s,
        reason: `${rowCount} 个分类 × ${numericCols.length} 指标`,
      });
    }

    // pie: 1 个分类 + 1 个数值 + 项数 ≤ 8
    if (categoryCols.length === 1 && numericCols.length === 1 && rowCount <= 8 && rowCount >= 2) {
      out.push({ type: 'pie', score: 65, reason: `${rowCount} 个分类的占比` });
    }

    // scatter: 至少 2 个数值字段 + 行数 ≥ 10
    if (numericCols.length >= 2 && rowCount >= 10) {
      out.push({
        type: 'scatter',
        score: 55,
        reason: `${numericCols.length} 个数值字段散点关系`,
      });
    }

    // heatmap: 2 个分类字段 + 1 个数值字段 + 数据稠密
    if (
      categoryCols.length >= 2 &&
      numericCols.length >= 1 &&
      rowCount >= 4 &&
      rowCount <= 500
    ) {
      out.push({
        type: 'heatmap',
        score: 50,
        reason: `2D 矩阵：${categoryCols[0].col.name} × ${categoryCols[1].col.name}`,
      });
    }

    return out;
  }

  private render(
    type: ChartConfig['type'],
    result: QueryResult,
    shape: DataShape,
    reason: string,
  ): ChartConfig {
    switch (type) {
      case 'line':
        return this.buildLineChart(result, shape, reason);
      case 'bar':
        return this.buildBarChart(result, shape, reason);
      case 'pie':
        return this.buildPieChart(result, shape, reason);
      case 'scatter':
        return this.buildScatterChart(result, shape, reason);
      case 'heatmap':
        return this.buildHeatmap(result, shape, reason);
      default:
        return { ...this.buildTable(result), reason };
    }
  }

  // ============== 数据形态分析 ==============
  private analyzeShape(result: QueryResult): DataShape {
    const columns: ColumnShape[] = result.columns.map((col) => {
      const values = result.rows.slice(0, 200).map((r) => r[col.name]);
      const distinctCount = new Set(values.filter((v) => v !== null && v !== undefined)).size;
      const isTime = this.isTimeOrDate(col);
      const isNum = !isTime && this.isNumericColumn(col, values);
      let kind: ColumnShape['kind'] = 'unknown';
      if (isTime) kind = 'time';
      else if (isNum) kind = 'numeric';
      else if (values.every((v) => v === null || typeof v === 'boolean')) kind = 'boolean';
      else if (values.every((v) => v === null || typeof v === 'string')) kind = 'string';
      return {
        col,
        kind,
        distinctCount,
        isHighCardinality: distinctCount > 50,
      };
    });
    return {
      rowCount: result.rowCount,
      columns,
      timeCols: columns.filter((c) => c.kind === 'time'),
      numericCols: columns.filter((c) => c.kind === 'numeric'),
      categoryCols: columns.filter((c) => c.kind === 'string' || c.kind === 'boolean'),
    };
  }

  private isTimeOrDate(col: ColumnInfo): boolean {
    const t = (col.type || '').toLowerCase();
    return (
      t.includes('date') ||
      t.includes('time') ||
      t.includes('timestamp') ||
      /(_at|_time|_date|_dt|_hour|_day|_month|_year)$/.test(col.name)
    );
  }

  private isNumericColumn(col: ColumnInfo, sample: any[]): boolean {
    const numericTypes = ['int', 'numeric', 'real', 'double', 'bigint', 'smallint', 'integer', 'float', 'decimal'];
    if (numericTypes.some((t) => col.type?.toLowerCase().includes(t))) return true;
    const nonNull = sample.filter((v) => v !== null && v !== undefined);
    if (nonNull.length === 0) return false;
    return nonNull.every((v) => typeof v === 'number');
  }

  // ============== 渲染各类图表 ==============
  private buildLineChart(result: QueryResult, shape: DataShape, reason: string): ChartConfig {
    const xField = shape.timeCols[0]?.col.name || result.columns[0].name;
    const yFields = shape.numericCols.map((c) => c.col.name);
    const xData = result.rows.map((r) => this.formatX(r[xField]));
    const series = yFields.map((field) => ({
      name: field,
      type: 'line',
      smooth: true,
      data: result.rows.map((r) => r[field]),
    }));
    return {
      type: 'line',
      reason,
      option: {
        tooltip: { trigger: 'axis' },
        legend: yFields.length > 1 ? { data: yFields, top: 0 } : undefined,
        grid: { left: 50, right: 20, top: yFields.length > 1 ? 40 : 20, bottom: 60 },
        xAxis: { type: 'category', data: xData, axisLabel: { rotate: xData.length > 8 ? 30 : 0 } },
        yAxis: { type: 'value' },
        series,
      },
    };
  }

  private buildBarChart(result: QueryResult, shape: DataShape, reason: string): ChartConfig {
    const xField = shape.categoryCols[0]?.col.name || result.columns[0].name;
    const yFields = shape.numericCols.map((c) => c.col.name);
    const xData = result.rows.map((r) => String(r[xField] ?? '-'));
    const series = yFields.map((field) => ({
      name: field,
      type: 'bar',
      data: result.rows.map((r) => r[field]),
    }));
    return {
      type: 'bar',
      reason,
      option: {
        tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
        legend: yFields.length > 1 ? { data: yFields, top: 0 } : undefined,
        grid: { left: 60, right: 20, top: yFields.length > 1 ? 40 : 20, bottom: 80 },
        xAxis: { type: 'category', data: xData, axisLabel: { rotate: xData.length > 6 ? 30 : 0 } },
        yAxis: { type: 'value' },
        series,
      },
    };
  }

  private buildPieChart(result: QueryResult, shape: DataShape, reason: string): ChartConfig {
    const nameField = shape.categoryCols[0]?.col.name || result.columns[0].name;
    const valueField = shape.numericCols[0]?.col.name;
    if (!valueField) return { ...this.buildTable(result), reason };
    return {
      type: 'pie',
      reason,
      option: {
        tooltip: { trigger: 'item', formatter: '{b}: {c} ({d}%)' },
        legend: { orient: 'vertical', left: 'left' },
        series: [
          {
            name: valueField,
            type: 'pie',
            radius: '65%',
            data: result.rows.map((r) => ({
              name: String(r[nameField] ?? '-'),
              value: r[valueField],
            })),
          },
        ],
      },
    };
  }

  private buildScatterChart(result: QueryResult, shape: DataShape, reason: string): ChartConfig {
    const [xCol, yCol] = shape.numericCols;
    return {
      type: 'scatter',
      reason,
      option: {
        tooltip: { trigger: 'item' },
        xAxis: { name: xCol.col.name, type: 'value' },
        yAxis: { name: yCol.col.name, type: 'value' },
        series: [
          {
            type: 'scatter',
            symbolSize: 10,
            data: result.rows.map((r) => [r[xCol.col.name], r[yCol.col.name]]),
          },
        ],
      },
    };
  }

  private buildHeatmap(result: QueryResult, shape: DataShape, reason: string): ChartConfig {
    const [xCat, yCat] = shape.categoryCols;
    const valueField = shape.numericCols[0].col.name;
    const xs = Array.from(new Set(result.rows.map((r) => String(r[xCat.col.name]))));
    const ys = Array.from(new Set(result.rows.map((r) => String(r[yCat.col.name]))));
    const data: [number, number, number][] = result.rows.map((r) => [
      xs.indexOf(String(r[xCat.col.name])),
      ys.indexOf(String(r[yCat.col.name])),
      r[valueField],
    ]);
    const max = Math.max(...data.map((d) => d[2] || 0));
    return {
      type: 'heatmap',
      reason,
      option: {
        tooltip: { position: 'top' },
        grid: { left: 80, bottom: 80 },
        xAxis: { type: 'category', data: xs, splitArea: { show: true } },
        yAxis: { type: 'category', data: ys, splitArea: { show: true } },
        visualMap: { min: 0, max, orient: 'horizontal', left: 'center', bottom: 0 },
        series: [
          {
            type: 'heatmap',
            data,
            label: { show: true },
          },
        ],
      },
    };
  }

  private buildTable(result: QueryResult): ChartConfig {
    return {
      type: 'table',
      table: {
        columns: result.columns.map((c) => ({
          title: c.name,
          dataIndex: c.name,
          key: c.name,
        })),
        rows: result.rows,
      },
    };
  }

  private formatX(v: any): string {
    if (v == null) return '-';
    if (v instanceof Date) return v.toISOString().substring(0, 10);
    return String(v);
  }
}
