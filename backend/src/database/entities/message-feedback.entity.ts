import { Column, Entity, Index } from 'typeorm';
import { BaseEntity } from './base.entity';

export enum FeedbackType {
  GOOD = 'good',
  BAD = 'bad',
}

/**
 * 用户对 assistant 消息的反馈
 *
 * good：可选附带 "saveAsTemplate" → 沉淀为 SuggestedQuestion (source=learned)
 * bad：可选附带 notes，工程师可在管理后台筛查
 */
@Entity({ name: 'message_feedback', schema: 'app' })
export class MessageFeedback extends BaseEntity {
  @Index()
  @Column({ name: 'message_id', type: 'uuid' })
  messageId: string;

  @Index()
  @Column({ name: 'user_id', type: 'uuid', nullable: true })
  userId?: string;

  @Column({ type: 'varchar', length: 20 })
  type: FeedbackType;

  @Column({ type: 'text', nullable: true })
  notes?: string;

  /** 标记 good 时是否已沉淀为 SuggestedQuestion */
  @Column({ name: 'saved_as_template', type: 'boolean', default: false })
  savedAsTemplate: boolean;
}
