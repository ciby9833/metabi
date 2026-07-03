import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import { EvalReport } from './types';

/**
 * EvalHistoryService — 读取历史 eval-reports/*.json 供 admin dashboard 用
 *
 * 设计：
 *   - 直接读 disk（报告本身是 immutable JSON，无需入 DB）
 *   - list 只返 summary（不加载 results[] 全文）
 *   - 缓存文件列表 60s，避免每次请求都 scan
 */

export interface EvalRunSummary {
  runId: string;
  filename: string;
  startedAt: string;
  finishedAt: string;
  totalDurationMs: number;
  totalTasks: number;
  passed: number;
  failed: number;
  passRate: number;
  avgSteps: number;
  avgTokens: number;
  avgLatencyMs: number;
  retryRate: number;
  avgRetries: number;
  tokensPerAccepted: number;
}

@Injectable()
export class EvalHistoryService {
  private readonly logger = new Logger(EvalHistoryService.name);
  private readonly reportsDir: string;
  private cachedList: EvalRunSummary[] = [];
  private cachedAt = 0;
  private readonly CACHE_TTL_MS = 60 * 1000;

  constructor() {
    this.reportsDir = path.join(process.cwd(), 'eval-reports');
  }

  /** 列出所有历史 run（按 startedAt 倒序）*/
  async list(): Promise<EvalRunSummary[]> {
    if (Date.now() - this.cachedAt < this.CACHE_TTL_MS && this.cachedList.length > 0) {
      return this.cachedList;
    }
    if (!fs.existsSync(this.reportsDir)) {
      return [];
    }

    const files = fs
      .readdirSync(this.reportsDir)
      .filter((f) => f.endsWith('.json') && f.startsWith('eval-'));

    const summaries: EvalRunSummary[] = [];
    for (const filename of files) {
      try {
        const raw = fs.readFileSync(path.join(this.reportsDir, filename), 'utf8');
        const report = JSON.parse(raw) as EvalReport;
        const s = report.summary;
        summaries.push({
          runId: report.runId,
          filename,
          startedAt: report.startedAt,
          finishedAt: report.finishedAt,
          totalDurationMs: report.totalDurationMs,
          totalTasks: s.totalTasks,
          passed: s.passed,
          failed: s.failed,
          passRate: s.passRate,
          avgSteps: s.avgSteps,
          avgTokens: s.avgTokens,
          avgLatencyMs: s.avgLatencyMs,
          retryRate: s.retryRate ?? 0,
          avgRetries: s.avgRetries ?? 0,
          tokensPerAccepted: s.tokensPerAccepted ?? 0,
        });
      } catch (err) {
        this.logger.warn(`Failed to parse ${filename}: ${(err as Error).message}`);
      }
    }

    summaries.sort((a, b) => (a.startedAt < b.startedAt ? 1 : -1));
    this.cachedList = summaries;
    this.cachedAt = Date.now();
    return summaries;
  }

  /** 拿单 run 完整报告 */
  async getOne(runId: string): Promise<EvalReport> {
    const summaries = await this.list();
    const meta = summaries.find((s) => s.runId === runId);
    if (!meta) throw new NotFoundException(`Eval run ${runId} not found`);
    const raw = fs.readFileSync(path.join(this.reportsDir, meta.filename), 'utf8');
    return JSON.parse(raw) as EvalReport;
  }
}
