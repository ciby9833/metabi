import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Phase D · 文件导出
 * 新增 exported_files 表 — AI 生成的 Excel/CSV/PDF 元数据
 */
export class AddExportedFiles1782600000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS app.exported_files (
        id uuid PRIMARY KEY DEFAULT public.uuid_generate_v4(),
        owner_id uuid NOT NULL,
        conversation_id uuid,
        message_id uuid,
        filename varchar(255) NOT NULL,
        mime_type varchar(100) NOT NULL,
        size_bytes bigint NOT NULL,
        storage_path varchar(500) NOT NULL,
        description text,
        created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_exported_files_owner_id ON app.exported_files (owner_id);`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_exported_files_conversation_id ON app.exported_files (conversation_id);`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS app.exported_files;`);
  }
}
