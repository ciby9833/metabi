import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Phase L + M + O · 看板体系
 *
 * dev 已通过 synchronize=true 自动建表；此 migration 补上生产脚本，
 * 一次带齐后续 M/O 阶段字段（params / layout），避免多次 ALTER。
 *
 * IF NOT EXISTS + ADD COLUMN IF NOT EXISTS 保证 dev/prod 都可幂等执行。
 */
export class AddDashboardsAndWidgets1782700000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // ============ dashboards ============
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS app.dashboards (
        id uuid PRIMARY KEY DEFAULT public.uuid_generate_v4(),
        owner_id uuid NOT NULL,
        project_id uuid,
        name varchar(255) NOT NULL,
        description text,
        icon varchar(10),
        layout jsonb,
        created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_dashboards_owner_id ON app.dashboards (owner_id);`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_dashboards_project_id ON app.dashboards (project_id);`,
    );
    // 已存在的表补 layout 列（dev 环境）
    await queryRunner.query(`ALTER TABLE app.dashboards ADD COLUMN IF NOT EXISTS layout jsonb;`);

    // ============ widgets ============
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS app.widgets (
        id uuid PRIMARY KEY DEFAULT public.uuid_generate_v4(),
        dashboard_id uuid NOT NULL,
        title varchar(255) NOT NULL,
        description text,
        datasource_id uuid,
        dataset_ids jsonb,
        project_id uuid,
        sql text NOT NULL,
        params jsonb,
        chart_config jsonb NOT NULL,
        result_snapshot jsonb,
        position int NOT NULL DEFAULT 0,
        width varchar(10) NOT NULL DEFAULT 'half',
        height varchar(10) NOT NULL DEFAULT 'medium',
        created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_widgets_dashboard_id ON app.widgets (dashboard_id);`,
    );
    // 已存在的表补 params 列（dev 环境）
    await queryRunner.query(`ALTER TABLE app.widgets ADD COLUMN IF NOT EXISTS params jsonb;`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS app.widgets;`);
    await queryRunner.query(`DROP TABLE IF EXISTS app.dashboards;`);
  }
}
