import { Column, Entity, Index, Unique } from 'typeorm';
import { BaseEntity } from './base.entity';

/**
 * 数据源中某张表 / 某个字段的业务元数据
 *
 * 行设计：
 *   - column_name 为 NULL 表示「表级」元数据 (描述、时区)
 *   - column_name 非 NULL 表示「列级」元数据 (业务名、描述、单位)
 *
 * 唯一约束：(datasource_id, table_name, column_name) 三元组
 */
@Entity({ name: 'datasource_metadata', schema: 'app' })
@Unique('uq_datasource_table_column', ['datasourceId', 'tableName', 'columnName'])
export class DatasourceMetadata extends BaseEntity {
  @Index()
  @Column({ name: 'datasource_id', type: 'uuid' })
  datasourceId: string;

  @Index()
  @Column({ name: 'table_name', type: 'varchar', length: 255 })
  tableName: string;

  /** NULL = 表级元数据 */
  @Column({ name: 'column_name', type: 'varchar', length: 255, nullable: true })
  columnName?: string | null;

  /** 中文业务名（如 dispatcher_id → "派件员ID"）*/
  @Column({ name: 'business_name', type: 'varchar', length: 255, nullable: true })
  businessName?: string;

  /** 自由文本：用法、陷阱、枚举值解释 */
  @Column({ type: 'text', nullable: true })
  description?: string;

  /** 单位：单 / 件 / kg / % / 元 / ... 仅列级有意义 */
  @Column({ type: 'varchar', length: 20, nullable: true })
  unit?: string;

  /** 时区：仅表级有意义。用于 LLM 写 SQL 时插入 AT TIME ZONE */
  @Column({ name: 'timezone', type: 'varchar', length: 64, nullable: true })
  timezone?: string;

  /** 同义词列表：业务用户口语 → 这个字段。如 ["派件员", "快递员"] */
  @Column({ type: 'text', array: true, default: '{}' })
  synonyms: string[];
}
