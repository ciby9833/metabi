import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Phase C-A · User 加部门/角色 + Skill 加 visibility
 *
 * 设计原则：
 *   - 所有新字段 nullable（向后兼容，老用户/老 skill 无需迁移）
 *   - Skill.visibility 默认 'global' — 现有所有 skill 维持原可见性
 *   - 不破坏现有查询
 */
export class AddUserIdentityAndSkillVisibility1782500000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // ===== User =====
    await queryRunner.query(`
      ALTER TABLE app.users
        ADD COLUMN IF NOT EXISTS department varchar(100),
        ADD COLUMN IF NOT EXISTS job_role varchar(100);
    `);

    // ===== Skill =====
    await queryRunner.query(`
      ALTER TABLE app.skills
        ADD COLUMN IF NOT EXISTS visibility varchar(20) NOT NULL DEFAULT 'global',
        ADD COLUMN IF NOT EXISTS project_id uuid,
        ADD COLUMN IF NOT EXISTS owner_user_id uuid;
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_skills_visibility ON app.skills (visibility);
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_skills_project_id ON app.skills (project_id)
        WHERE project_id IS NOT NULL;
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_skills_owner_user_id ON app.skills (owner_user_id)
        WHERE owner_user_id IS NOT NULL;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS app.idx_skills_owner_user_id;`);
    await queryRunner.query(`DROP INDEX IF EXISTS app.idx_skills_project_id;`);
    await queryRunner.query(`DROP INDEX IF EXISTS app.idx_skills_visibility;`);
    await queryRunner.query(`
      ALTER TABLE app.skills
        DROP COLUMN IF EXISTS owner_user_id,
        DROP COLUMN IF EXISTS project_id,
        DROP COLUMN IF EXISTS visibility;
    `);
    await queryRunner.query(`
      ALTER TABLE app.users
        DROP COLUMN IF EXISTS job_role,
        DROP COLUMN IF EXISTS department;
    `);
  }
}
