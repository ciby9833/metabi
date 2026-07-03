import { Entity, Column, Index } from 'typeorm';
import { BaseEntity } from './base.entity';

/**
 * Sub-agent 调用归档
 *
 * 每次 Master 派遣一个 SkillAgent 子任务都存一条。
 * 用于：
 *   1. 主 agent 跨步骤复用（list_previous_subtasks）
 *   2. 多轮对话跨轮复用（用户问"延续刚才派件分析…"时找历史子任务）
 *   3. 前端推理轨迹展示（树形：master step → sub agent 内部 steps）
 */
@Entity({ name: 'subagent_calls', schema: 'app' })
@Index('idx_subagent_conv', ['conversationId'])
@Index('idx_subagent_parent_msg', ['parentMessageId'])
export class SubAgentCall extends BaseEntity {
  @Column({ name: 'conversation_id', type: 'uuid' })
  conversationId: string;

  /** 哪条 assistant 消息触发了这次 sub-agent 调用 */
  @Column({ name: 'parent_message_id', type: 'uuid', nullable: true })
  parentMessageId?: string | null;

  /** Master agent 第几步派的（用于轨迹树形结构）*/
  @Column({ name: 'master_step', type: 'integer' })
  masterStep: number;

  /** 派遣给哪个 skill */
  @Column({ name: 'skill_name', type: 'varchar', length: 100 })
  skillName: string;

  /** Master 派下来的子问题（缩窄到该 skill 能答的部分）*/
  @Column({ name: 'sub_question', type: 'text' })
  subQuestion: string;

  // ============ 子 agent 完整运行结果 ============

  /** 子 agent 的完整 transcript（含所有 tool calls）— 用于召回 */
  @Column({ name: 'raw_messages', type: 'jsonb', nullable: true })
  rawMessages?: any;

  /** 最终执行的 SQL */
  @Column({ name: 'final_sql', type: 'text', nullable: true })
  finalSql?: string | null;

  /** 结果列 + 数据快照 */
  @Column({ name: 'result_columns', type: 'jsonb', nullable: true })
  resultColumns?: { name: string; type: string }[] | null;

  @Column({ name: 'result_rows', type: 'jsonb', nullable: true })
  resultRows?: Record<string, any>[] | null;

  @Column({ name: 'result_row_count', type: 'integer', nullable: true })
  resultRowCount?: number | null;

  /** 子 agent 给 Master 的总结（narrative） */
  @Column({ type: 'text', nullable: true })
  narrative?: string | null;

  @Column({ type: 'boolean', default: false })
  refused: boolean;

  @Column({ name: 'total_tokens', type: 'integer', nullable: true })
  totalTokens?: number | null;

  @Column({ name: 'duration_ms', type: 'integer', nullable: true })
  durationMs?: number | null;

  /** 给 Master 看的压缩结果（含前 5 行数据 + narrative）*/
  @Column({ name: 'compact_summary', type: 'jsonb', nullable: true })
  compactSummary?: any;
}
