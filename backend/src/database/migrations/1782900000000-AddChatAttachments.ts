import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Phase W · Chat 附件（图片/表/PDF/文本）
 *
 * 用户在对话里拖拽 / 粘贴 / 点选上传的文件；每条 message 通过 attachments jsonb 引用 id
 */
export class AddChatAttachments1782900000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS app.chat_attachments (
        id uuid PRIMARY KEY DEFAULT public.uuid_generate_v4(),
        owner_id uuid NOT NULL,
        message_id uuid,
        kind varchar(20) NOT NULL,
        filename varchar(255) NOT NULL,
        mime_type varchar(100) NOT NULL,
        size_bytes bigint NOT NULL,
        storage_path varchar(500) NOT NULL,
        preview jsonb,
        created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_chat_attachments_owner_id ON app.chat_attachments (owner_id);`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_chat_attachments_message_id ON app.chat_attachments (message_id);`,
    );
    await queryRunner.query(
      `ALTER TABLE app.messages ADD COLUMN IF NOT EXISTS attachments jsonb;`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE app.messages DROP COLUMN IF EXISTS attachments;`);
    await queryRunner.query(`DROP TABLE IF EXISTS app.chat_attachments;`);
  }
}
