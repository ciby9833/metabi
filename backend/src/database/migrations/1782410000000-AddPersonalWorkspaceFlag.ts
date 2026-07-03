import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Project 表加 is_personal_workspace 字段 + 每用户唯一约束。
 *
 * 用于"上传数据 = Project Knowledge"重构：每个用户自动有一个 Personal Workspace
 * project，所有 dataset 必须挂在某个 project 下。
 */
export class AddPersonalWorkspaceFlag1782410000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE app.projects
        ADD COLUMN IF NOT EXISTS is_personal_workspace boolean NOT NULL DEFAULT false;
    `);
    // partial unique: 每个 owner 最多一个 personal workspace
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS uq_projects_one_personal_per_owner
        ON app.projects (owner_id)
        WHERE is_personal_workspace = true;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS app.uq_projects_one_personal_per_owner;`);
    await queryRunner.query(`ALTER TABLE app.projects DROP COLUMN IF EXISTS is_personal_workspace;`);
  }
}
