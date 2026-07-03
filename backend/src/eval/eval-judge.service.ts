/**
 * Eval Judge — 纯规则判断 task 是否 passed
 *
 * 关键原则：**不用 LLM 评 LLM**（循环依赖 + 不确定）。
 * 所有判断都是确定的字符串匹配 / 数值比较 / 集合操作。
 *
 * 若期望项中某项未声明，则不参与判断（不影响通过）。
 */
import { Injectable } from '@nestjs/common';
import { EvalTask, EvalResult } from './types';

@Injectable()
export class EvalJudgeService {
  /** 修改 result.passed 和 result.failureReasons */
  judge(task: EvalTask, result: EvalResult): EvalResult {
    const reasons: string[] = [];
    const e = task.expected;
    const narrative = result.trace.narrative || '';
    const sqlAll = result.trace.sqlExecuted.join('\n').toLowerCase();
    const toolsUsed = new Set(result.trace.toolCalls.map((c) => c.toolName));

    // runtime error / refusal
    if (result.trace.error) {
      reasons.push(`runtime error: ${result.trace.error}`);
    }
    if (e.shouldNotRefuse && result.trace.refused) {
      reasons.push('refused but shouldNotRefuse=true');
    }
    if (e.shouldHaveSqlResult && (result.metrics.sqlResultRowCount ?? 0) === 0) {
      reasons.push('no SQL result rows but shouldHaveSqlResult=true');
    }
    if (
      typeof e.sqlResultMinRows === 'number' &&
      (result.metrics.sqlResultRowCount ?? 0) < e.sqlResultMinRows
    ) {
      reasons.push(
        `sql rows=${result.metrics.sqlResultRowCount} < min ${e.sqlResultMinRows}`,
      );
    }

    // narrative content
    if (e.mustContain) {
      for (const s of e.mustContain) {
        if (!narrative.includes(s)) {
          reasons.push(`narrative missing "${s}"`);
        }
      }
    }
    if (e.mustContainAny && e.mustContainAny.length > 0) {
      const anyHit = e.mustContainAny.some((s) => narrative.includes(s));
      if (!anyHit) {
        reasons.push(`narrative missing any of: ${e.mustContainAny.map((s) => `"${s}"`).join(' / ')}`);
      }
    }
    if (e.mustNotContain) {
      for (const s of e.mustNotContain) {
        if (narrative.includes(s)) {
          reasons.push(`narrative contains forbidden "${s}"`);
        }
      }
    }
    if (e.mustContainNumbers) {
      for (const n of e.mustContainNumbers) {
        const variants = this.numberVariants(n);
        const found = variants.some((v) => narrative.includes(v));
        if (!found) {
          reasons.push(`narrative missing number ${n} (tried: ${variants.join('|')})`);
        }
      }
    }

    // SQL constraints
    if (e.sqlMustReferenceTable) {
      for (const tbl of e.sqlMustReferenceTable) {
        if (!sqlAll.includes(tbl.toLowerCase())) {
          reasons.push(`SQL missing reference to table "${tbl}"`);
        }
      }
    }
    if (e.sqlMustContainJoin && !/\bjoin\b/i.test(sqlAll)) {
      reasons.push('SQL missing JOIN');
    }

    // Tools
    if (e.toolsMustUse) {
      for (const tool of e.toolsMustUse) {
        if (!toolsUsed.has(tool)) {
          reasons.push(`tool "${tool}" not used but required`);
        }
      }
    }
    if (e.toolsMustNotUse) {
      for (const tool of e.toolsMustNotUse) {
        if (toolsUsed.has(tool)) {
          reasons.push(`tool "${tool}" used but forbidden`);
        }
      }
    }

    // Limits
    if (typeof e.maxSteps === 'number' && result.metrics.steps > e.maxSteps) {
      reasons.push(`steps=${result.metrics.steps} > max ${e.maxSteps}`);
    }
    if (typeof e.maxTokens === 'number' && result.metrics.totalTokens > e.maxTokens) {
      reasons.push(`tokens=${result.metrics.totalTokens} > max ${e.maxTokens}`);
    }
    if (typeof e.maxLatencyMs === 'number' && result.metrics.latencyMs > e.maxLatencyMs) {
      reasons.push(`latency=${result.metrics.latencyMs}ms > max ${e.maxLatencyMs}ms`);
    }

    result.failureReasons = reasons;
    result.passed = reasons.length === 0;
    return result;
  }

  /** 数字的多种字面形式：500 → ["500","500.0","500.00"] + 中文千分位变体 */
  private numberVariants(n: number | string): string[] {
    const num = typeof n === 'number' ? n : parseFloat(n);
    if (!Number.isFinite(num)) return [String(n)];

    const variants = new Set<string>();
    variants.add(String(n));
    variants.add(String(num));
    variants.add(num.toFixed(0));
    variants.add(num.toFixed(1));
    variants.add(num.toFixed(2));
    // 千分位逗号
    variants.add(num.toLocaleString('en-US'));
    // 中文万单位（10000+）
    if (Math.abs(num) >= 10000) {
      const wan = num / 10000;
      variants.add(`${wan.toFixed(0)}万`);
      variants.add(`${wan.toFixed(1)}万`);
      variants.add(`${wan.toFixed(2)}万`);
    }
    return Array.from(variants);
  }
}
