import { Injectable } from '@nestjs/common';
import { Insight } from '../tools/tool.types';

interface InputData {
  columns: { name: string; type: string }[];
  rows: Record<string, any>[];
  rowCount: number;
}

/**
 * StatisticalInsightService
 *
 * 基于查询结果的**确定性**统计规则发现"值得说的点"
 * 不调用 LLM，0 成本，永远可靠
 *
 * 涵盖：
 *  - 数值列异常 (z-score > 2σ)
 *  - 占比集中 (Top 1 > 50%)
 *  - 空值率 (单列 NULL > 10%)
 *  - 时序断点 (相邻日期间隔异常)
 *  - 单调趋势 (连续单调上升/下降)
 */
@Injectable()
export class StatisticalInsightService {
  detect(data: InputData): Insight[] {
    const out: Insight[] = [];
    if (!data || data.rowCount === 0) return out;

    const numericCols = this.findNumericColumns(data);
    const timeCols = this.findTimeColumns(data);

    // 1) 数值列异常
    for (const col of numericCols) {
      const vals = this.collectNumeric(data.rows, col.name);
      if (vals.length < 4) continue;
      const outliers = this.detectOutliers(vals);
      if (outliers.length > 0) {
        const top = outliers[0];
        out.push({
          severity: Math.abs(top.zScore) > 3 ? 'critical' : 'warning',
          kind: 'anomaly',
          text: `字段「${col.name}」在第 ${top.index + 1} 行出现异常值 ${this.fmt(top.value)}（偏离均值 ${this.fmt(top.zScore)}σ；均值 ${this.fmt(top.mean)}，标准差 ${this.fmt(top.std)}）`,
        });
      }
    }

    // 2) 占比集中（仅当首列是类别字段且只有一个数值字段时才检测）
    if (data.rowCount >= 2 && data.rowCount <= 50 && numericCols.length >= 1) {
      const valueCol = numericCols[0].name;
      const labelCol = data.columns[0].name;
      const items = data.rows
        .map((r) => ({
          label: String(r[labelCol] ?? '-'),
          val: Number(r[valueCol]) || 0,
        }))
        .filter((it) => it.val > 0)
        .sort((a, b) => b.val - a.val);
      const total = items.reduce((s, it) => s + it.val, 0);
      if (total > 0 && items.length > 0) {
        const top1Pct = items[0].val / total;
        if (top1Pct > 0.5) {
          out.push({
            severity: top1Pct > 0.7 ? 'warning' : 'info',
            kind: 'concentration',
            text: `Top 1「${items[0].label}」占总量 ${(top1Pct * 100).toFixed(1)}%，分布高度集中`,
          });
        }
        // 帕累托检查
        if (items.length >= 5) {
          const top20PctCount = Math.max(1, Math.ceil(items.length * 0.2));
          const top20Sum = items.slice(0, top20PctCount).reduce((s, it) => s + it.val, 0);
          const top20Pct = top20Sum / total;
          if (top20Pct > 0.85) {
            out.push({
              severity: 'info',
              kind: 'concentration',
              text: `前 20% 项目（${top20PctCount} 个）贡献了 ${(top20Pct * 100).toFixed(1)}% 总量，符合典型的二八规律`,
            });
          }
        }
      }
    }

    // 3) NULL 率
    for (const col of data.columns) {
      const nullCount = data.rows.filter(
        (r) => r[col.name] === null || r[col.name] === undefined,
      ).length;
      const nullRatio = nullCount / data.rowCount;
      if (nullRatio > 0.1) {
        out.push({
          severity: nullRatio > 0.3 ? 'warning' : 'info',
          kind: 'data_quality',
          text: `字段「${col.name}」空值率 ${(nullRatio * 100).toFixed(0)}%（${nullCount}/${data.rowCount}），可能影响指标准确性`,
        });
      }
    }

    // 4) 时序断点
    if (timeCols.length > 0 && data.rowCount >= 3) {
      const tCol = timeCols[0].name;
      const sortedTimes = data.rows
        .map((r) => new Date(r[tCol] as any).getTime())
        .filter((t) => !isNaN(t))
        .sort((a, b) => a - b);
      if (sortedTimes.length >= 3) {
        const gaps: number[] = [];
        for (let i = 1; i < sortedTimes.length; i++) {
          gaps.push(sortedTimes[i] - sortedTimes[i - 1]);
        }
        const medianGap = this.median(gaps);
        const bigGap = gaps.findIndex((g) => g > medianGap * 3 && medianGap > 0);
        if (bigGap >= 0) {
          const d1 = new Date(sortedTimes[bigGap]).toISOString().substring(0, 10);
          const d2 = new Date(sortedTimes[bigGap + 1]).toISOString().substring(0, 10);
          out.push({
            severity: 'warning',
            kind: 'data_quality',
            text: `时间序列在 ${d1} 到 ${d2} 之间有断点（间隔 ${this.humanGap(gaps[bigGap])}，常规间隔约 ${this.humanGap(medianGap)}）`,
          });
        }
      }
    }

    // 5) 连续单调趋势
    if (numericCols.length >= 1 && data.rowCount >= 4) {
      const valueCol = numericCols[0].name;
      const seq = data.rows.map((r) => Number(r[valueCol])).filter((v) => !isNaN(v));
      if (seq.length >= 4) {
        const monotonic = this.checkMonotonic(seq);
        if (monotonic === 'up' || monotonic === 'down') {
          const delta = (seq[seq.length - 1] - seq[0]) / Math.max(Math.abs(seq[0]), 1);
          out.push({
            severity: 'info',
            kind: 'trend',
            text: `「${valueCol}」连续 ${seq.length} 个数据点${monotonic === 'up' ? '单调上升' : '单调下降'}，整体变化 ${(delta * 100).toFixed(0)}%`,
          });
        }
      }
    }

    return out;
  }

  // ============ helpers ============

  private findNumericColumns(data: InputData) {
    return data.columns.filter((c) => {
      const numericKw = ['int', 'numeric', 'real', 'double', 'bigint', 'smallint', 'float', 'decimal'];
      if (numericKw.some((k) => c.type?.toLowerCase().includes(k))) return true;
      const sample = data.rows.slice(0, 5).map((r) => r[c.name]);
      const nonNull = sample.filter((v) => v !== null && v !== undefined);
      if (nonNull.length === 0) return false;
      return nonNull.every((v) => typeof v === 'number');
    });
  }

  private findTimeColumns(data: InputData) {
    return data.columns.filter((c) => {
      const t = (c.type || '').toLowerCase();
      return t.includes('date') || t.includes('time') || t.includes('timestamp');
    });
  }

  private collectNumeric(rows: Record<string, any>[], colName: string): number[] {
    return rows
      .map((r) => r[colName])
      .filter((v) => v !== null && v !== undefined)
      .map(Number)
      .filter((v) => !isNaN(v));
  }

  private detectOutliers(vals: number[]) {
    const mean = vals.reduce((s, v) => s + v, 0) / vals.length;
    const variance = vals.reduce((s, v) => s + (v - mean) ** 2, 0) / vals.length;
    const std = Math.sqrt(variance);
    if (std === 0) return [];
    const out: { index: number; value: number; zScore: number; mean: number; std: number }[] = [];
    vals.forEach((v, i) => {
      const z = (v - mean) / std;
      if (Math.abs(z) > 2) {
        out.push({ index: i, value: v, zScore: z, mean, std });
      }
    });
    return out.sort((a, b) => Math.abs(b.zScore) - Math.abs(a.zScore));
  }

  private median(arr: number[]): number {
    if (arr.length === 0) return 0;
    const sorted = [...arr].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  }

  private checkMonotonic(seq: number[]): 'up' | 'down' | 'mixed' {
    let up = true;
    let down = true;
    for (let i = 1; i < seq.length; i++) {
      if (seq[i] < seq[i - 1]) up = false;
      if (seq[i] > seq[i - 1]) down = false;
    }
    if (up) return 'up';
    if (down) return 'down';
    return 'mixed';
  }

  private fmt(v: number): string {
    if (!isFinite(v)) return '-';
    if (Math.abs(v) >= 10000) return v.toFixed(0);
    if (Math.abs(v) < 1) return v.toFixed(2);
    return v.toFixed(1);
  }

  private humanGap(ms: number): string {
    const sec = ms / 1000;
    if (sec < 60) return `${sec.toFixed(0)} 秒`;
    if (sec < 3600) return `${(sec / 60).toFixed(0)} 分`;
    if (sec < 86400) return `${(sec / 3600).toFixed(0)} 小时`;
    return `${(sec / 86400).toFixed(0)} 天`;
  }
}
