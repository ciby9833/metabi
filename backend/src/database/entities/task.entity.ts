import { Entity, Column, Index } from 'typeorm';
import { BaseEntity } from './base.entity';

export enum TaskStatus {
  PENDING = 'pending',
  RUNNING = 'running',
  SUCCESS = 'success',
  FAILED = 'failed',
  DISABLED = 'disabled',
}

@Entity({ name: 'tasks', schema: 'app' })
export class Task extends BaseEntity {
  @Column({ type: 'varchar', length: 255 })
  name: string;

  @Column({ type: 'text', nullable: true })
  description?: string;

  @Column({ name: 'cron_expression', type: 'varchar', length: 100, nullable: true })
  cronExpression?: string;

  // 用户输入的问题（自然语言）
  @Column({ type: 'text' })
  question: string;

  @Column({ name: 'datasource_id', type: 'uuid', nullable: true })
  datasourceId?: string;

  @Column({ name: 'conversation_id', type: 'uuid', nullable: true })
  conversationId?: string;

  @Index()
  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean;

  @Column({ name: 'last_run_at', type: 'timestamptz', nullable: true })
  lastRunAt?: Date;

  @Column({ name: 'next_run_at', type: 'timestamptz', nullable: true })
  nextRunAt?: Date;

  @Column({ name: 'last_status', type: 'varchar', length: 50, nullable: true })
  lastStatus?: TaskStatus;

  // 飞书推送配置
  @Column({ name: 'feishu_webhook', type: 'varchar', length: 500, nullable: true })
  feishuWebhook?: string;

  @Column({ name: 'created_by', type: 'uuid', nullable: true })
  createdBy?: string;

  @Column({ name: 'retry_count', type: 'int', default: 3 })
  retryCount: number;
}
