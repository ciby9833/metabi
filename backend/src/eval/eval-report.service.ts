/**
 * Eval Report — 把 EvalResult[] 汇总成 markdown + 写文件
 */
import { Injectable, Logger } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import { EvalResult, EvalReport } from './types';

@Injectable()
export class EvalReportService {
  private readonly logger = new Logger(EvalReportService.name);

  /** 汇总 results → EvalReport（含 byCategory 统计）*/
  buildReport(runId: string, startedAt: Date, results: EvalResult[]): EvalReport {
    const finishedAt = new Date();
    const passed = results.filter((r) => r.passed).length;
    const failed = results.length - passed;

    const byCategory: Record<string, any> = {};
    for (const r of results) {
      if (!byCategory[r.category]) {
        byCategory[r.category] = {
          total: 0,
          passed: 0,
          sumSteps: 0,
          sumTokens: 0,
        };
      }
      const c = byCategory[r.category];
      c.total++;
      if (r.passed) c.passed++;
      c.sumSteps += r.metrics.steps;
      c.sumTokens += r.metrics.totalTokens;
    }
    // finalize avg
    for (const k of Object.keys(byCategory)) {
      const c = byCategory[k];
      c.avgSteps = c.total > 0 ? +(c.sumSteps / c.total).toFixed(1) : 0;
      c.avgTokens = c.total > 0 ? Math.round(c.sumTokens / c.total) : 0;
      delete c.sumSteps;
      delete c.sumTokens;
    }

    const avg = (sel: (r: EvalResult) => number) =>
      results.length > 0 ? results.reduce((s, r) => s + sel(r), 0) / results.length : 0;

    const retriedTasks = results.filter((r) => r.metrics.verifierRetries > 0).length;
    const passedTokens = results
      .filter((r) => r.passed)
      .reduce((s, r) => s + r.metrics.totalTokens, 0);

    return {
      runId,
      startedAt: startedAt.toISOString(),
      finishedAt: finishedAt.toISOString(),
      totalDurationMs: finishedAt.getTime() - startedAt.getTime(),
      summary: {
        totalTasks: results.length,
        passed,
        failed,
        passRate: results.length > 0 ? +(passed / results.length).toFixed(3) : 0,
        avgSteps: +avg((r) => r.metrics.steps).toFixed(1),
        avgTokens: Math.round(avg((r) => r.metrics.totalTokens)),
        avgLatencyMs: Math.round(avg((r) => r.metrics.latencyMs)),
        retryRate: results.length > 0 ? +(retriedTasks / results.length).toFixed(3) : 0,
        avgRetries: +avg((r) => r.metrics.verifierRetries).toFixed(2),
        tokensPerAccepted: passed > 0 ? Math.round(passedTokens / passed) : 0,
      },
      byCategory,
      results,
    };
  }

  /** 写 markdown 到 backend/eval-reports/{ts}.md，返回路径 */
  writeMarkdown(report: EvalReport, outputDir?: string): string {
    const dir = outputDir || path.join(process.cwd(), 'eval-reports');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const ts = report.startedAt.replace(/[:.]/g, '-').substring(0, 19);
    const filePath = path.join(dir, `eval-${ts}.md`);
    fs.writeFileSync(filePath, this.renderMarkdown(report), 'utf8');
    this.logger.log(`Eval report written: ${filePath}`);
    return filePath;
  }

  /** 同时写 JSON 便于 dashboard 消费 */
  writeJson(report: EvalReport, outputDir?: string): string {
    const dir = outputDir || path.join(process.cwd(), 'eval-reports');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const ts = report.startedAt.replace(/[:.]/g, '-').substring(0, 19);
    const filePath = path.join(dir, `eval-${ts}.json`);
    fs.writeFileSync(filePath, JSON.stringify(report, null, 2), 'utf8');
    return filePath;
  }

  private renderMarkdown(r: EvalReport): string {
    const s = r.summary;
    const lines: string[] = [];
    lines.push(`# Eval Report · ${r.runId}`);
    lines.push('');
    lines.push(`- 开始：${r.startedAt}`);
    lines.push(`- 结束：${r.finishedAt}`);
    lines.push(`- 耗时：${(r.totalDurationMs / 1000).toFixed(1)}s`);
    lines.push('');
    lines.push(`## Summary`);
    lines.push('');
    lines.push(`| 指标 | 值 |`);
    lines.push(`|---|---|`);
    lines.push(`| 通过率 | **${(s.passRate * 100).toFixed(1)}%** (${s.passed}/${s.totalTasks}) |`);
    lines.push(`| 平均步数 | ${s.avgSteps} |`);
    lines.push(`| 平均 tokens | ${s.avgTokens.toLocaleString()} |`);
    lines.push(`| 平均延迟 | ${(s.avgLatencyMs / 1000).toFixed(1)}s |`);
    lines.push(`| **Tokens / accepted change** | **${s.tokensPerAccepted.toLocaleString()}** |`);
    lines.push(`| Verifier 返工率 | ${(s.retryRate * 100).toFixed(1)}% |`);
    lines.push(`| Verifier 平均返工次数 | ${s.avgRetries} |`);
    lines.push('');

    lines.push(`## By Category`);
    lines.push('');
    lines.push(`| 分类 | 通过/总数 | 通过率 | 平均步数 | 平均 tokens |`);
    lines.push(`|---|---|---|---|---|`);
    for (const [cat, c] of Object.entries(r.byCategory)) {
      const rate = c.total > 0 ? (c.passed / c.total) * 100 : 0;
      lines.push(`| ${cat} | ${c.passed}/${c.total} | ${rate.toFixed(0)}% | ${c.avgSteps} | ${c.avgTokens.toLocaleString()} |`);
    }
    lines.push('');

    // Failed tasks 详情
    const failed = r.results.filter((x) => !x.passed);
    if (failed.length > 0) {
      lines.push(`## ❌ Failed Tasks (${failed.length})`);
      lines.push('');
      for (const f of failed) {
        lines.push(`### ${f.taskId} · ${f.category}`);
        lines.push('');
        lines.push(`**Reasons**：`);
        for (const reason of f.failureReasons) {
          lines.push(`- ${reason}`);
        }
        lines.push('');
        lines.push(`**Metrics**：steps=${f.metrics.steps} tokens=${f.metrics.totalTokens} latency=${(f.metrics.latencyMs / 1000).toFixed(1)}s retries=${f.metrics.verifierRetries} conf=${f.metrics.finalConfidence?.toFixed(2) ?? '?'}`);
        lines.push('');
        lines.push(`**Skill**：${f.trace.skillUsed} · **Refused**：${f.trace.refused}`);
        lines.push('');
        lines.push(`**Tools (${f.trace.toolCalls.length})**：${f.trace.toolCalls.map((t) => `${t.toolName}(${t.durationMs}ms)`).join(' → ')}`);
        lines.push('');
        if (f.trace.narrative) {
          lines.push(`**Narrative**：`);
          lines.push('```');
          lines.push(f.trace.narrative.substring(0, 500));
          lines.push('```');
        }
        if (f.trace.error) {
          lines.push(`**Runtime Error**：${f.trace.error}`);
        }
        // Verifier trace（如果有）
        if (f.trace.verifierReviews && f.trace.verifierReviews.length > 0) {
          lines.push('');
          lines.push('**Verifier Reviews**：');
          for (const v of f.trace.verifierReviews) {
            const dims = v.dimensions;
            lines.push(
              `- Attempt ${v.attempt}: conf=${(v.confidence * 10).toFixed(1)}/10 · ` +
                `answ=${dims.answersQuestion} sql=${dims.sqlConsistency} join=${dims.joinCompleteness} ` +
                `num=${dims.numericalPrecision} halluc=${dims.noHallucination} · ` +
                `retry=${v.shouldRetry} refuse=${v.shouldRefuse}`,
            );
            if (v.feedback) lines.push(`  - feedback: ${v.feedback.substring(0, 200)}`);
            if (v.concerns.length > 0) lines.push(`  - concerns: ${v.concerns.slice(0, 3).join('; ')}`);
          }
        }
        lines.push('');
        lines.push('---');
        lines.push('');
      }
    }

    // Passed 摘要
    const passed = r.results.filter((x) => x.passed);
    if (passed.length > 0) {
      lines.push(`## ✅ Passed Tasks (${passed.length})`);
      lines.push('');
      lines.push(`| Task | Steps | Tokens | Latency |`);
      lines.push(`|---|---|---|---|`);
      for (const p of passed) {
        lines.push(`| ${p.taskId} | ${p.metrics.steps} | ${p.metrics.totalTokens.toLocaleString()} | ${(p.metrics.latencyMs / 1000).toFixed(1)}s |`);
      }
    }

    return lines.join('\n');
  }
}
