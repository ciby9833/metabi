import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Phase 3 · Sub-agent (Master/Skill Agent 架构)
 *
 *   - 新表：subagent_calls — 每次 Master 派遣子 agent 的归档（含完整 transcript + 结果）
 *   - conversations 加 mode 字段：'single_skill' | 'master'，老对话默认 single_skill 不受影响
 */
export class AddSubAgentCallsAndConversationMode1782292285000
  implements MigrationInterface
{
  name = 'AddSubAgentCallsAndConversationMode1782292285000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1) subagent_calls 表
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS app.subagent_calls (
        id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
        created_at timestamptz DEFAULT now() NOT NULL,
        updated_at timestamptz DEFAULT now() NOT NULL,
        conversation_id uuid NOT NULL,
        parent_message_id uuid,
        master_step integer NOT NULL,
        skill_name varchar(100) NOT NULL,
        sub_question text NOT NULL,
        raw_messages jsonb,
        final_sql text,
        result_columns jsonb,
        result_rows jsonb,
        result_row_count integer,
        narrative text,
        refused boolean DEFAULT false NOT NULL,
        total_tokens integer,
        duration_ms integer,
        compact_summary jsonb,
        CONSTRAINT "PK_subagent_calls" PRIMARY KEY (id)
      );
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_subagent_conv ON app.subagent_calls(conversation_id);`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_subagent_parent_msg ON app.subagent_calls(parent_message_id);`,
    );

    // 2) conversations 加 mode 字段
    await queryRunner.query(`
      ALTER TABLE app.conversations
      ADD COLUMN IF NOT EXISTS mode varchar(20) DEFAULT 'single_skill' NOT NULL;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE app.conversations DROP COLUMN IF EXISTS mode;`);
    await queryRunner.query(`DROP TABLE IF EXISTS app.subagent_calls;`);
  }
}
