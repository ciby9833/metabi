import { Entity, Column, Index, ManyToOne, JoinColumn } from 'typeorm';
import { BaseEntity } from './base.entity';
import { Conversation } from './conversation.entity';

export enum MessageRole {
  USER = 'user',
  ASSISTANT = 'assistant',
  SYSTEM = 'system',
}

@Entity({ name: 'messages', schema: 'app' })
export class Message extends BaseEntity {
  @Index()
  @Column({ name: 'conversation_id', type: 'uuid' })
  conversationId: string;

  @ManyToOne(() => Conversation, (conversation) => conversation.messages, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'conversation_id' })
  conversation: Conversation;

  @Column({ type: 'varchar', length: 50 })
  role: MessageRole;

  @Column({ type: 'text' })
  content: string;

  @Column({ name: 'sql_text', type: 'text', nullable: true })
  sqlText?: string;

  @Column({ name: 'chart_config', type: 'jsonb', nullable: true })
  chartConfig?: Record<string, any>;

  @Column({ name: 'result_data', type: 'jsonb', nullable: true })
  resultData?: Record<string, any>;

  @Column({ type: 'jsonb', nullable: true })
  metadata?: Record<string, any>;

  /**
   * 附件 id 引用 — 具体元数据在 chat_attachments 表
   * 只在 user 消息上非空；assistant 通常不带附件
   */
  @Column({ type: 'jsonb', nullable: true })
  attachments?: string[];
}
