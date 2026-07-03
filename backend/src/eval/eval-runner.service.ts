/**
 * Eval Runner — 跑单个 EvalTask 并收集 metrics
 *
 * 设计：
 *   - 直接调 PlannerAgent.runStream() drive generator（不走 SSE/conversation 持久化）
 *   - 数据准备走真实路径：DatasetService.uploadAndParse + confirmAndImport
 *   - 跑完 cleanup：删除临时 dataset（避免污染线上数据）
 *
 * 一个真实 task 流程：
 *   1. 创建 admin 临时用户上下文（沿用现有 admin）
 *   2. 上传 setup 中的 csvs → 等 status=ready
 *   3. 装配 ProjectSkill → 拿到 systemPrompt + allowedTables
 *   4. 调 planner.runStream → drive 收集所有 events + finalOutput
 *   5. 整理成 EvalResult.trace + EvalResult.metrics
 *   6. 删除临时 datasets
 */
import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In } from 'typeorm';
import { User } from '../database/entities';
import { PlannerAgent, PlannerEvent, PlannerOutput } from '../core/agents/planner.agent';
import { DatasetService } from '../modules/dataset/services/dataset.service';
import { ProjectSkillAssemblerService } from '../modules/dataset/services/project-skill-assembler.service';
import { ProjectService } from '../modules/project/services/project.service';
import { EvalTask, EvalResult, EvalSetup } from './types';

interface RunContext {
  user: User;
  datasourceId: string;
}

@Injectable()
export class EvalRunnerService {
  private readonly logger = new Logger(EvalRunnerService.name);

  constructor(
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    private readonly planner: PlannerAgent,
    private readonly datasetService: DatasetService,
    private readonly projectSkillAssembler: ProjectSkillAssemblerService,
    private readonly projectService: ProjectService,
  ) {}

  /** 跑一个任务，无论成功失败都返回 EvalResult */
  async runOne(task: EvalTask, ctx: RunContext): Promise<EvalResult> {
    const tStart = Date.now();
    const createdDatasetIds: string[] = [];

    const events: PlannerEvent[] = [];
    let finalOutput: PlannerOutput | undefined;
    let runtimeError: string | undefined;

    try {
      // ===== 1. Setup datasets =====
      const datasetIds = await this.setupDatasets(task.setup, ctx, createdDatasetIds);

      // ===== 2. 装配 ProjectSkill（dataset 模式）或走 enterprise =====
      let overrideAllowedTables: string[] | undefined;
      let datasetContext: string | undefined;
      if (task.setup.mode === 'dataset' && datasetIds.length > 0) {
        const personalWs = await this.projectService.ensurePersonalWorkspace(ctx.user.id);
        const skill = await this.projectSkillAssembler.assemble(personalWs.id, datasetIds);
        overrideAllowedTables = skill.allowedTables;
        datasetContext = skill.systemPrompt;
      }

      // ===== 3. Drive Planner generator =====
      const gen = this.planner.runStream({
        question: task.question,
        datasourceId: task.setup.datasourceId || ctx.datasourceId,
        userId: ctx.user.id,
        overrideAllowedTables,
        datasetContext,
      });

      while (true) {
        const r = await gen.next();
        if (r.done) {
          finalOutput = r.value;
          break;
        }
        events.push(r.value);
        // Eval 不响应 clarify — 强制空答案让它继续/拒答
        if (r.value.type === 'clarify_request') {
          // 给空答案推进；planner 会按"未答"处理
          const r2 = await gen.next('');
          if (r2.done) {
            finalOutput = r2.value;
            break;
          }
          events.push(r2.value);
        }
      }
    } catch (err) {
      runtimeError = (err as Error).message || String(err);
      this.logger.error(`Eval task ${task.id} runtime error: ${runtimeError}`);
    } finally {
      // ===== Cleanup =====
      for (const dsId of createdDatasetIds) {
        try {
          await this.datasetService.delete(dsId, ctx.user.id);
        } catch (err) {
          this.logger.warn(`Cleanup dataset ${dsId} failed: ${(err as Error).message}`);
        }
      }
    }

    const latencyMs = Date.now() - tStart;
    return this.buildResult(task, events, finalOutput, runtimeError, latencyMs);
  }

  /** 准备 datasets（同步等到 ready）*/
  private async setupDatasets(
    setup: EvalSetup,
    ctx: RunContext,
    createdIds: string[],
  ): Promise<string[]> {
    if (!setup.datasets || setup.datasets.length === 0) return [];
    const ids: string[] = [];

    for (const dsSetup of setup.datasets) {
      // 1) upload + parse
      const csvBuffer = Buffer.from(dsSetup.csv, 'utf8');
      const ds = await this.datasetService.uploadAndParse(
        {
          buffer: csvBuffer,
          originalname: `${dsSetup.name}.csv`,
          mimetype: 'text/csv',
          size: csvBuffer.length,
        },
        ctx.user.id,
      );
      createdIds.push(ds.id);

      // 2) merge column descriptions
      const columns = (ds.columns || []).map((c) => ({
        ...c,
        description:
          dsSetup.columnDescriptions?.[c.name] ||
          (c.originalName ? dsSetup.columnDescriptions?.[c.originalName] : undefined) ||
          c.description ||
          '',
      }));

      // 3) confirm + import（异步 in-process）
      await this.datasetService.confirmAndImport(ds.id, ctx.user.id, {
        displayName: dsSetup.name,
        description: dsSetup.description,
        columns,
      });

      // 4) poll until ready (max 30s)
      const readyDs = await this.pollReady(ds.id, ctx.user.id, 30000);
      if (readyDs.status !== 'ready') {
        throw new Error(
          `Dataset ${dsSetup.name} not ready after 30s: status=${readyDs.status} err=${readyDs.errorMessage}`,
        );
      }
      ids.push(readyDs.id);
    }
    return ids;
  }

  private async pollReady(datasetId: string, userId: string, timeoutMs: number) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const ds = await this.datasetService.getAccessible(datasetId, userId);
      if (ds.status === 'ready' || ds.status === 'failed') return ds;
      await new Promise((r) => setTimeout(r, 300));
    }
    return this.datasetService.getAccessible(datasetId, userId);
  }

  /** 整理 events + finalOutput → EvalResult（未 judge） */
  private buildResult(
    task: EvalTask,
    events: PlannerEvent[],
    output: PlannerOutput | undefined,
    runtimeError: string | undefined,
    latencyMs: number,
  ): EvalResult {
    const toolCalls = events
      .filter((e) => e.type === 'tool_executing')
      .map((e: any) => ({
        step: e.step as number,
        toolName: e.toolName as string,
        argsPreview: JSON.stringify(e.args).substring(0, 200),
        durationMs: 0,
      }));
    // attach duration from tool_result
    events
      .filter((e) => e.type === 'tool_result')
      .forEach((e: any) => {
        const tc = toolCalls.find((c) => c.step === e.step && c.toolName === e.toolName);
        if (tc) tc.durationMs = e.durationMs || 0;
      });

    const sqlExecuted = events
      .filter((e: any) => e.type === 'tool_executing' && e.toolName === 'run_sql')
      .map((e: any) => (e.args?.sql || '').substring(0, 500));

    // 抽 Verifier 每次评审详情（关键排查用）
    const verifierReviews = events
      .filter((e: any) => e.type === 'verifier_check')
      .map((e: any) => ({
        attempt: e.attempt,
        confidence: e.review?.confidence,
        dimensions: e.review?.dimensions,
        shouldRetry: e.review?.shouldRetry,
        shouldRefuse: e.review?.shouldRefuse,
        concerns: e.review?.concerns || [],
        feedback: e.review?.feedback || '',
        summary: e.review?.summary || '',
      }));

    const finalize = output?.finalize;
    const sqlResult = output?.sqlResult;
    const skillUsed = output?.skill?.meta?.name || 'unknown';

    const lastStep = toolCalls.length > 0 ? Math.max(...toolCalls.map((c) => c.step)) : 0;
    // verifier_retry 事件数 = 实际返工次数（第 N 次返工 emit attempt=N）
    const verifierRetries = events.filter((e) => e.type === 'verifier_retry').length;

    return {
      taskId: task.id,
      category: task.category,
      passed: false, // judge 后填
      failureReasons: [],
      metrics: {
        steps: lastStep,
        totalTokens: output?.totalTokens || 0,
        latencyMs,
        sqlResultRowCount: sqlResult?.rowCount ?? null,
        verifierRetries,
        finalConfidence: typeof finalize?.confidence === 'number' ? finalize.confidence : null,
      },
      trace: {
        skillUsed,
        toolCalls,
        sqlExecuted,
        narrative: finalize?.narrative || '',
        refused: !!finalize?.refused,
        error: runtimeError,
        verifierReviews: verifierReviews.length > 0 ? verifierReviews : undefined,
      },
    };
  }
}
