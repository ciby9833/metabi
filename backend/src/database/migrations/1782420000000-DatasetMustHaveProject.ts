import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * 强制 user_datasets.project_id NOT NULL —— "Dataset 必须属于 Project" 重构。
 *
 * 处理老数据：
 *   - 对每个有 personal dataset 的 owner，确保有 Personal Workspace project
 *   - 把 personal dataset 的 project_id 迁过去
 */
export class DatasetMustHaveProject1782420000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1) 找出有 personal dataset 的 owner
    const ownersResult: { owner_id: string }[] = await queryRunner.query(
      `SELECT DISTINCT owner_id FROM app.user_datasets WHERE project_id IS NULL;`,
    );

    for (const { owner_id } of ownersResult) {
      // 2) 确保该 owner 有 personal workspace（如果之前 ensurePersonalWorkspace 没被调过）
      let wsResult: { id: string }[] = await queryRunner.query(
        `SELECT id FROM app.projects WHERE owner_id = $1 AND is_personal_workspace = true LIMIT 1;`,
        [owner_id],
      );
      let workspaceId: string;
      if (wsResult.length > 0) {
        workspaceId = wsResult[0].id;
      } else {
        const created: { id: string }[] = await queryRunner.query(
          `INSERT INTO app.projects
             (name, description, icon, owner_id, is_active, is_personal_workspace)
           VALUES ($1, $2, $3, $4, true, true)
           RETURNING id;`,
          ['我的工作区', '默认的个人工作空间 — 上传的私有数据集和分析会话默认归这里', '🏠', owner_id],
        );
        workspaceId = created[0].id;
      }

      // 3) 把该 owner 的所有 personal dataset 迁到 workspace
      await queryRunner.query(
        `UPDATE app.user_datasets SET project_id = $1 WHERE owner_id = $2 AND project_id IS NULL;`,
        [workspaceId, owner_id],
      );
    }

    // 4) 加 NOT NULL 约束
    await queryRunner.query(`ALTER TABLE app.user_datasets ALTER COLUMN project_id SET NOT NULL;`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE app.user_datasets ALTER COLUMN project_id DROP NOT NULL;`);
    // 不还原数据 — 老 personal dataset 的归属已经合理化了
  }
}
