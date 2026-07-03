import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/**
 * Turn 事件持久化 — 一个 turn（= 1 条 assistant message）的所有中间事件。
 *
 * 用途：
 *  - SSE 断线重连：客户端按 seq 续传，把已发生事件 replay 完再续推 generator
 *  - 历史回放：未来重新打开对话时，回放推理过程（工具调用、clarify 等）
 *  - 失败诊断：服务器重启时正在跑的 turn 卡在哪一步可查
 *
 * 一个 turn 内每个事件**先写表再 SSE 推**，保证持久化与推送一致。
 */
@Entity({ name: 'turn_events' })
@Index('idx_turn_events_turn_seq', ['turnId', 'seq'])
@Index('idx_turn_events_conv_created', ['conversationId', 'createdAt'])
export class TurnEvent {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /**
   * 关联到 messages.id（一个 assistant message = 一个 turn 容器）。
   * 注：在 turn 真正完成（finalize）前 message 可能还没创建，此时为 null；
   * finalize 后回填 turnId。
   */
  @Column({ type: 'uuid', name: 'turn_id', nullable: true })
  turnId: string | null;

  @Column({ type: 'uuid', name: 'conversation_id' })
  conversationId: string;

  /** Turn 内事件序号 — 0, 1, 2, ... */
  @Column({ type: 'int' })
  seq: number;

  /**
   * 事件类型：
   *   turn_start / llm_call_start / llm_call_end / tool_executing / tool_result /
   *   clarify_request / clarify_resolved / finalize / error
   *   master_step / sub_agent_dispatch / sub_agent_result（Master 路径）
   */
  @Column({ type: 'varchar', length: 64 })
  type: string;

  /** 完整事件 payload（含工具 args/output、clarify 字段、错误信息等）*/
  @Column({ type: 'jsonb' })
  payload: any;

  @Column({ type: 'timestamptz', name: 'created_at', default: () => 'CURRENT_TIMESTAMP' })
  createdAt: Date;
}
