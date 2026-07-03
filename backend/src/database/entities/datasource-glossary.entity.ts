import { Column, Entity, Index } from 'typeorm';
import { BaseEntity } from './base.entity';

/**
 * 业务术语词典（跨表）
 *
 * 例：派件员 = dispatcher_id；人效 = sum(piece_count) / count(distinct dispatcher_id)
 * 由数据治理 / 业务管理员在前端维护，注入 LLM prompt 当 hints。
 */
@Entity({ name: 'datasource_glossary', schema: 'app' })
export class DatasourceGlossary extends BaseEntity {
  @Index()
  @Column({ name: 'datasource_id', type: 'uuid' })
  datasourceId: string;

  /** 业务术语（用户口语） */
  @Column({ type: 'varchar', length: 255 })
  term: string;

  /** 含义 / SQL 表达式 (markdown 可) */
  @Column({ type: 'text' })
  meaning: string;

  /** 范例 SQL 片段（可选）*/
  @Column({ name: 'example_sql', type: 'text', nullable: true })
  exampleSql?: string;

  /** 适用的表名（空 = 全部适用） */
  @Column({ name: 'applies_to_tables', type: 'text', array: true, default: '{}' })
  appliesToTables: string[];
}
