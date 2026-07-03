import { Entity, Column, Index } from 'typeorm';
import { BaseEntity } from './base.entity';

export enum SqlExecutionStatus {
  SUCCESS = 'success',
  ERROR = 'error',
  TIMEOUT = 'timeout',
  BLOCKED = 'blocked',
}

@Entity({ name: 'sql_records', schema: 'app' })
export class SqlRecord extends BaseEntity {
  @Index()
  @Column({ name: 'conversation_id', type: 'uuid', nullable: true })
  conversationId?: string;

  @Index()
  @Column({ name: 'datasource_id', type: 'uuid', nullable: true })
  datasourceId?: string;

  @Column({ name: 'sql_text', type: 'text' })
  sqlText: string;

  @Column({ type: 'text', nullable: true })
  question?: string;

  @Column({ name: 'execution_time_ms', type: 'int', nullable: true })
  executionTimeMs?: number;

  @Column({ name: 'result_rows', type: 'int', nullable: true })
  resultRows?: number;

  @Column({ type: 'varchar', length: 50 })
  status: SqlExecutionStatus;

  @Column({ name: 'error_message', type: 'text', nullable: true })
  errorMessage?: string;

  @Column({ name: 'user_id', type: 'uuid', nullable: true })
  userId?: string;

  @Column({ name: 'from_cache', type: 'boolean', default: false })
  fromCache: boolean;
}
