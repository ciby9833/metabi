import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Phase V · Widget 加 detail_sql 字段
 *
 * 存到看板时 AI 一次性脱聚合生成明细 SQL 固化到此字段。
 * 后续下载明细 / AI 解读时直接用，避免每次调 LLM。
 */
export class AddWidgetDetailSql1782800000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE app.widgets ADD COLUMN IF NOT EXISTS detail_sql text;`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE app.widgets DROP COLUMN IF EXISTS detail_sql;`);
  }
}
