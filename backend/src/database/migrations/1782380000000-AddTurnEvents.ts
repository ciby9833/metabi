import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Phase 4 · SSE 双向流改造
 *
 *   - 新表：turn_events — 每个 turn 的中间事件持久化（工具调用/clarify/finalize 等）
 *
 * 用途：
 *   - SSE 断线重连：按 seq replay 已发生事件再续推 generator
 *   - 失败诊断：服务器重启时正在跑的 turn 卡在哪一步可查
 *   - 历史回放：未来重新打开对话时回放推理过程
 */
export class AddTurnEvents1782380000000 implements MigrationInterface {
  name = 'AddTurnEvents1782380000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS app.turn_events (
        id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
        turn_id uuid,
        conversation_id uuid NOT NULL,
        seq integer NOT NULL,
        type varchar(64) NOT NULL,
        payload jsonb NOT NULL,
        created_at timestamptz DEFAULT now() NOT NULL,
        CONSTRAINT "PK_turn_events" PRIMARY KEY (id)
      );
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_turn_events_turn_seq ON app.turn_events(turn_id, seq);`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_turn_events_conv_created ON app.turn_events(conversation_id, created_at);`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS app.turn_events;`);
  }
}
