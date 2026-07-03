import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Phase 5 · User Self-Service Data Upload
 *
 *   - 新表 user_datasets：用户上传的数据集元数据
 *   - 新 schema user_data：用户上传数据物理表的所在地（独立于业务 schema）
 *
 * 注意：本 migration 不创建专用 db role（chatbi_user_data）。生产部署应另外执行：
 *   CREATE ROLE chatbi_user_data NOINHERIT;
 *   GRANT USAGE ON SCHEMA user_data TO chatbi_user_data;
 *   GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA user_data TO chatbi_user_data;
 *   ALTER DEFAULT PRIVILEGES IN SCHEMA user_data GRANT SELECT ON TABLES TO chatbi_user_data;
 *
 * 应用层防御（不依赖 DB role 也安全）：ToolContext.allowedTables 白名单 + API 层 ownerId 校验。
 */
export class AddUserDatasets1782400000000 implements MigrationInterface {
  name = 'AddUserDatasets1782400000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1) user_data schema — 用户上传的物理表都在这
    await queryRunner.query(`CREATE SCHEMA IF NOT EXISTS user_data;`);

    // 2) user_datasets 元数据表（在 app schema）
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS app.user_datasets (
        id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
        owner_id uuid NOT NULL,
        project_id uuid,
        source_filename varchar(255) NOT NULL,
        source_size_bytes bigint NOT NULL,
        source_mime varchar(100) NOT NULL,
        table_name varchar(63),
        display_name varchar(255) NOT NULL,
        description text,
        columns jsonb,
        row_count integer,
        status varchar(32) DEFAULT 'pending' NOT NULL,
        error_message text,
        temp_file_path text,
        created_at timestamptz DEFAULT now() NOT NULL,
        updated_at timestamptz DEFAULT now() NOT NULL,
        CONSTRAINT "PK_user_datasets" PRIMARY KEY (id)
      );
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_user_dataset_owner ON app.user_datasets(owner_id);`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_user_dataset_project ON app.user_datasets(project_id);`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_user_dataset_status ON app.user_datasets(status);`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS app.user_datasets;`);
    // user_data schema 不 DROP（保留以防有数据；如需彻底清理手动 DROP SCHEMA user_data CASCADE）
  }
}
