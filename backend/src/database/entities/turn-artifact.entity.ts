import { Column, Entity, Index } from 'typeorm';
import { BaseEntity } from './base.entity';

/**
 * 一轮 (user + assistant) 完整对话的副本
 *
 * 设计目的：让多轮下钻时 Agent 能"按需召回"真实历史，而不只是看摘要。
 *
 * - raw_messages：完整 ConversationMessage[]（含 tool_calls + tool_results）
 * - result_rows：最后一次成功 run_sql 的真实结果数据（最多 1000 行）
 *
 * 与 Message 表分离的原因：
 *   1. 体积大（rows / tool 输出动辄 100KB+），避免拖慢 Message 查询
 *   2. 独立归档/清理策略（如对话超 30 天后 truncate raw_messages 只留 result_rows）
 */
@Entity({ name: 'turn_artifacts', schema: 'app' })
export class TurnArtifact extends BaseEntity {
  @Index()
  @Column({ name: 'conversation_id', type: 'uuid' })
  conversationId: string;

  @Index()
  @Column({ name: 'message_id', type: 'uuid' })
  messageId: string;

  /** 这一轮在会话里的次序，1-based */
  @Index()
  @Column({ name: 'turn_index', type: 'int' })
  turnIndex: number;

  /** 这一轮 user 提的问题 */
  @Column({ name: 'user_question', type: 'text' })
  userQuestion: string;

  /** 助手最终播报（completed/refused 都填） */
  @Column({ name: 'assistant_narrative', type: 'text', nullable: true })
  assistantNarrative: string | null;

  /** 是否拒答 */
  @Column({ name: 'refused', type: 'boolean', default: false })
  refused: boolean;

  /** 完整 ConversationMessage[]，含 system / user / assistant.tool_calls / tool_result */
  @Column({ name: 'raw_messages', type: 'jsonb', nullable: true })
  rawMessages: any[] | null;

  /** 最后一次成功 run_sql 的列定义 */
  @Column({ name: 'result_columns', type: 'jsonb', nullable: true })
  resultColumns: { name: string; type: string }[] | null;

  /** 最后一次成功 run_sql 的完整行数据（已被 SQL Engine 限制在 maxRows=1000 内） */
  @Column({ name: 'result_rows', type: 'jsonb', nullable: true })
  resultRows: Record<string, any>[] | null;

  /** 总行数（可能 > result_rows.length，如果 truncated） */
  @Column({ name: 'result_row_count', type: 'int', nullable: true })
  resultRowCount: number | null;

  /** 这一轮的最终 SQL */
  @Column({ name: 'final_sql', type: 'text', nullable: true })
  finalSql: string | null;
}
