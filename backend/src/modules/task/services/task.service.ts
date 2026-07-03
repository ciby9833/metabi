import { ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Cron, CronExpression } from '@nestjs/schedule';
import * as cronParser from 'cron-parser';
import { Task, TaskStatus } from '../../../database/entities';
import { ChatOrchestratorService } from '../../../core/orchestrator/chat-orchestrator.service';
import { FeishuService } from '../../../providers/feishu/feishu.service';
import { CreateTaskDto, UpdateTaskDto } from '../dto/task.dto';

@Injectable()
export class TaskService {
  private readonly logger = new Logger(TaskService.name);
  /** 防止重叠执行的 in-flight 标记 */
  private readonly inFlight = new Set<string>();

  constructor(
    @InjectRepository(Task)
    private readonly taskRepo: Repository<Task>,
    private readonly orchestrator: ChatOrchestratorService,
    private readonly feishu: FeishuService,
  ) {}

  async list(createdBy: string) {
    const data = await this.taskRepo
      .createQueryBuilder('t')
      .where('t.created_by = :uid OR t.created_by IS NULL', { uid: createdBy })
      .orderBy('t.created_at', 'DESC')
      .getMany();
    return { data, total: data.length };
  }

  async getById(id: string, createdBy?: string) {
    const task = await this.taskRepo.findOne({ where: { id } });
    if (!task) throw new NotFoundException(`Task ${id} not found`);
    if (createdBy && task.createdBy && task.createdBy !== createdBy) {
      throw new ForbiddenException('无权访问该任务');
    }
    return task;
  }

  async create(dto: CreateTaskDto, createdBy: string) {
    this.parseCron(dto.cronExpression);

    const task = this.taskRepo.create({
      name: dto.name,
      description: dto.description,
      question: dto.question,
      cronExpression: dto.cronExpression,
      datasourceId: dto.datasourceId,
      feishuWebhook: dto.feishuWebhook,
      isActive: dto.isActive ?? true,
      retryCount: dto.retryCount ?? 3,
      nextRunAt: this.computeNextRun(dto.cronExpression),
      createdBy,
    });
    return this.taskRepo.save(task);
  }

  async update(id: string, dto: UpdateTaskDto, createdBy: string) {
    const existing = await this.getById(id, createdBy);
    if (dto.cronExpression && dto.cronExpression !== existing.cronExpression) {
      this.parseCron(dto.cronExpression);
      existing.nextRunAt = this.computeNextRun(dto.cronExpression);
    }
    Object.assign(existing, dto);
    return this.taskRepo.save(existing);
  }

  async delete(id: string, createdBy: string) {
    const existing = await this.getById(id, createdBy);
    await this.taskRepo.delete(existing.id);
  }

  /** 手动触发执行（不受 cron 限制） */
  async execute(id: string, createdBy: string) {
    const task = await this.getById(id, createdBy);
    return this.runTask(task, /*pushFeishu*/ true);
  }

  /**
   * 每分钟巡检一次到期任务
   * 真正的调度逻辑：
   *   1. 找出 isActive=true 且 nextRunAt <= now 的任务
   *   2. 跳过正在运行的任务（避免重入）
   *   3. 串行触发（每次 sweep 启动多个任务为 fire-and-forget）
   *   4. 完成后更新 lastRunAt / lastStatus / nextRunAt
   */
  @Cron(CronExpression.EVERY_MINUTE)
  async sweepDueTasks() {
    const now = new Date();
    let dueTasks: Task[];
    try {
      dueTasks = await this.taskRepo
        .createQueryBuilder('task')
        .where('task.is_active = :active', { active: true })
        .andWhere(
          '(task.next_run_at IS NULL OR task.next_run_at <= :now)',
          { now },
        )
        .andWhere('task.cron_expression IS NOT NULL')
        .getMany();
    } catch (err) {
      this.logger.warn(`Sweep query failed (DB may not be ready): ${(err as Error).message}`);
      return;
    }

    if (dueTasks.length === 0) return;
    this.logger.log(`Sweep: ${dueTasks.length} task(s) due`);

    for (const task of dueTasks) {
      // 避免同一任务并发执行
      if (this.inFlight.has(task.id)) {
        this.logger.warn(`Task ${task.id} still in flight, skip`);
        continue;
      }
      // fire-and-forget
      this.runTask(task, /*pushFeishu*/ true).catch((err) =>
        this.logger.error(`Scheduled run failed for ${task.id}: ${err.message}`),
      );
    }
  }

  /**
   * 执行单个任务（含重试 + 飞书推送）
   */
  private async runTask(task: Task, pushFeishu: boolean) {
    if (!task.datasourceId) {
      throw new Error('Task has no associated datasource');
    }

    this.inFlight.add(task.id);
    const startedAt = new Date();
    const maxAttempts = Math.max(1, task.retryCount || 1);
    let lastError: Error | undefined;
    let result: any;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        this.logger.log(`Executing task ${task.name} (${task.id}) attempt ${attempt}/${maxAttempts}`);
        result = await this.orchestrator.run({
          question: task.question,
          datasourceId: task.datasourceId,
        });
        lastError = undefined;
        break;
      } catch (err) {
        lastError = err as Error;
        this.logger.warn(
          `Attempt ${attempt} failed for task ${task.id}: ${lastError.message}`,
        );
        // 指数退避：1s, 2s, 4s ...
        if (attempt < maxAttempts) {
          await this.delay(1000 * Math.pow(2, attempt - 1));
        }
      }
    }

    // 更新任务状态
    try {
      task.lastRunAt = startedAt;
      task.lastStatus = lastError ? TaskStatus.FAILED : TaskStatus.SUCCESS;
      task.nextRunAt = task.cronExpression
        ? this.computeNextRun(task.cronExpression)
        : undefined;
      await this.taskRepo.save(task);
    } catch (err) {
      this.logger.warn(`Failed to persist task state: ${(err as Error).message}`);
    }

    // 推送飞书
    if (pushFeishu && task.feishuWebhook) {
      try {
        if (lastError) {
          await this.feishu.sendTaskFailure(
            task.name,
            task.question,
            lastError.message,
            task.feishuWebhook,
          );
        } else {
          await this.feishu.sendTaskResult(
            {
              taskName: task.name,
              question: task.question,
              result,
            },
            task.feishuWebhook,
          );
        }
      } catch (err) {
        this.logger.warn(`Feishu push failed for task ${task.id}: ${(err as Error).message}`);
      }
    }

    this.inFlight.delete(task.id);

    if (lastError) {
      throw lastError;
    }
    return { taskId: task.id, status: TaskStatus.SUCCESS, result };
  }

  /** 计算下次执行时间 */
  private computeNextRun(cronExpression: string): Date | undefined {
    try {
      const interval = cronParser.parseExpression(cronExpression);
      return interval.next().toDate();
    } catch (err) {
      this.logger.warn(`Failed to compute next run for "${cronExpression}": ${(err as Error).message}`);
      return undefined;
    }
  }

  /** 验证 cron 表达式合法性 */
  private parseCron(cronExpression: string): void {
    try {
      cronParser.parseExpression(cronExpression);
    } catch (err) {
      throw new Error(`Invalid cron expression "${cronExpression}": ${(err as Error).message}`);
    }
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
