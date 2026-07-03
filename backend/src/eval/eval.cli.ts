/**
 * Eval CLI — 命令行入口
 *
 * 用法：
 *   npx ts-node src/eval/eval.cli.ts                # 跑全套
 *   npx ts-node src/eval/eval.cli.ts --tag=dataset_simple_agg     # 按 category 过滤
 *   npx ts-node src/eval/eval.cli.ts --task=eval-001              # 跑单个
 *   npx ts-node src/eval/eval.cli.ts --user=noelgfr@gmail.com     # 指定运行身份
 *
 * 输出：
 *   eval-reports/eval-YYYY-MM-DDTHH-MM-SS.md
 *   eval-reports/eval-YYYY-MM-DDTHH-MM-SS.json
 */
import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { AppModule } from '../app.module';
import { Repository } from 'typeorm';
import { getRepositoryToken } from '@nestjs/typeorm';
import { User, Datasource } from '../database/entities';
import { EvalRunnerService } from './eval-runner.service';
import { EvalJudgeService } from './eval-judge.service';
import { EvalReportService } from './eval-report.service';
import { ALL_EVAL_TASKS, STRESS_EVAL_TASKS } from './eval-tasks';
import { DATASET_MODE_TASKS } from './eval-tasks/dataset-mode';

interface CliArgs {
  tag?: string;
  task?: string;
  user?: string;
  /** 选 task 套件：all (默认) / basic / stress */
  suite?: 'all' | 'basic' | 'stress';
}

function parseArgs(): CliArgs {
  const args: CliArgs = {};
  for (const arg of process.argv.slice(2)) {
    const [key, value] = arg.replace(/^--/, '').split('=');
    if (key === 'tag') args.tag = value;
    else if (key === 'task') args.task = value;
    else if (key === 'user') args.user = value;
    else if (key === 'suite') args.suite = value as any;
  }
  return args;
}

async function main() {
  const logger = new Logger('EvalCLI');
  const args = parseArgs();

  // 选任务套件
  let tasks =
    args.suite === 'stress'
      ? STRESS_EVAL_TASKS
      : args.suite === 'basic'
        ? DATASET_MODE_TASKS
        : ALL_EVAL_TASKS;
  if (args.tag) tasks = tasks.filter((t) => t.category === args.tag);
  if (args.task) tasks = tasks.filter((t) => t.id === args.task);
  if (tasks.length === 0) {
    logger.error(`No tasks matched (tag=${args.tag} task=${args.task})`);
    process.exit(1);
  }
  logger.log(`Running ${tasks.length} eval task(s)`);

  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
  try {
    const userRepo = app.get<Repository<User>>(getRepositoryToken(User));
    const dsRepo = app.get<Repository<Datasource>>(getRepositoryToken(Datasource));
    const runner = app.get(EvalRunnerService);
    const judge = app.get(EvalJudgeService);
    const reporter = app.get(EvalReportService);

    // 选用户
    const userEmail = args.user || 'noelgfr@gmail.com';
    const user = await userRepo.findOne({ where: { email: userEmail } });
    if (!user) {
      logger.error(`User ${userEmail} not found`);
      process.exit(1);
    }
    // 选第一个 datasource 作为兜底（dataset 模式需要任一连接执行 SQL）
    const ds = await dsRepo.findOne({ where: {} });
    if (!ds) {
      logger.error('No datasource configured — cannot run eval');
      process.exit(1);
    }
    logger.log(`Run as ${user.email}, datasource=${ds.name}`);

    const runId = randomUUID().substring(0, 8);
    const startedAt = new Date();
    const results = [];

    for (const [i, task] of tasks.entries()) {
      logger.log(`[${i + 1}/${tasks.length}] ${task.id} · ${task.category}`);
      let result;
      try {
        result = await runner.runOne(task, { user, datasourceId: ds.id });
      } catch (err) {
        logger.error(`Task ${task.id} crashed: ${(err as Error).message}`);
        result = {
          taskId: task.id,
          category: task.category,
          passed: false,
          failureReasons: [`crashed: ${(err as Error).message}`],
          metrics: {
            steps: 0,
            totalTokens: 0,
            latencyMs: 0,
            sqlResultRowCount: null,
            verifierRetries: 0,
            finalConfidence: null,
          },
          trace: {
            skillUsed: '',
            toolCalls: [],
            sqlExecuted: [],
            narrative: '',
            refused: false,
            error: (err as Error).message,
          },
        };
      }
      result = judge.judge(task, result);
      results.push(result);
      const status = result.passed ? '✅' : '❌';
      const reasonStr = result.failureReasons.length > 0
        ? ` · ${result.failureReasons[0]}${result.failureReasons.length > 1 ? `+${result.failureReasons.length - 1}` : ''}`
        : '';
      logger.log(
        `  ${status} steps=${result.metrics.steps} tokens=${result.metrics.totalTokens} latency=${(result.metrics.latencyMs / 1000).toFixed(1)}s${reasonStr}`,
      );
    }

    const report = reporter.buildReport(runId, startedAt, results);
    const mdPath = reporter.writeMarkdown(report);
    const jsonPath = reporter.writeJson(report);

    logger.log('');
    logger.log('===== Summary =====');
    logger.log(`Pass rate: ${(report.summary.passRate * 100).toFixed(1)}% (${report.summary.passed}/${report.summary.totalTasks})`);
    logger.log(`Avg steps: ${report.summary.avgSteps}`);
    logger.log(`Avg tokens: ${report.summary.avgTokens.toLocaleString()}`);
    logger.log(`Avg latency: ${(report.summary.avgLatencyMs / 1000).toFixed(1)}s`);
    logger.log('');
    logger.log(`Report: ${mdPath}`);
    logger.log(`JSON:   ${jsonPath}`);

    process.exit(report.summary.failed > 0 ? 1 : 0);
  } finally {
    await app.close();
  }
}

main().catch((err) => {
  console.error('CLI crashed:', err);
  process.exit(1);
});
