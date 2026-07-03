import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Phase 2 · Project 模型
 *
 *   - projects 表（项目 / 工作空间）
 *   - project_members 表（成员 + 角色）
 *   - conversations 加 project_id 列（向后兼容，可空）
 *
 * 影响：
 *   已有 conversations 的 project_id 为 NULL（仍归个人）
 *   未来新建对话时前端可以指定 projectId
 */
export class AddProjects1782201798000 implements MigrationInterface {
  name = 'AddProjects1782201798000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1) projects 表
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS app.projects (
        id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
        created_at timestamptz DEFAULT now() NOT NULL,
        updated_at timestamptz DEFAULT now() NOT NULL,
        name varchar(255) NOT NULL,
        description text,
        icon varchar(100),
        owner_id uuid NOT NULL,
        system_instructions text,
        is_active boolean DEFAULT true NOT NULL,
        CONSTRAINT "PK_projects" PRIMARY KEY (id),
        CONSTRAINT "FK_projects_owner"
          FOREIGN KEY (owner_id) REFERENCES app.users(id) ON DELETE CASCADE
      );
    `);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_projects_owner" ON app.projects(owner_id);`);

    // 2) project_members 表
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS app.project_members (
        id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
        created_at timestamptz DEFAULT now() NOT NULL,
        updated_at timestamptz DEFAULT now() NOT NULL,
        project_id uuid NOT NULL,
        user_id uuid NOT NULL,
        role varchar(20) DEFAULT 'editor' NOT NULL,
        invited_by uuid,
        CONSTRAINT "PK_project_members" PRIMARY KEY (id),
        CONSTRAINT "FK_pm_project" FOREIGN KEY (project_id) REFERENCES app.projects(id) ON DELETE CASCADE,
        CONSTRAINT "FK_pm_user" FOREIGN KEY (user_id) REFERENCES app.users(id) ON DELETE CASCADE
      );
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS uq_project_user
      ON app.project_members(project_id, user_id);
    `);

    // 3) conversations 加 project_id
    await queryRunner.query(`
      ALTER TABLE app.conversations
      ADD COLUMN IF NOT EXISTS project_id uuid;
    `);
    await queryRunner.query(`
      ALTER TABLE app.conversations
      DROP CONSTRAINT IF EXISTS "FK_conversations_project";
    `);
    await queryRunner.query(`
      ALTER TABLE app.conversations
      ADD CONSTRAINT "FK_conversations_project"
        FOREIGN KEY (project_id) REFERENCES app.projects(id) ON DELETE SET NULL;
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_conversations_project"
      ON app.conversations(project_id);
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS app."IDX_conversations_project";`);
    await queryRunner.query(`ALTER TABLE app.conversations DROP CONSTRAINT IF EXISTS "FK_conversations_project";`);
    await queryRunner.query(`ALTER TABLE app.conversations DROP COLUMN IF EXISTS project_id;`);
    await queryRunner.query(`DROP TABLE IF EXISTS app.project_members;`);
    await queryRunner.query(`DROP TABLE IF EXISTS app.projects;`);
  }
}
