import { Column, Entity, Index, PrimaryGeneratedColumn, CreateDateColumn } from 'typeorm';

/**
 * Schema 元素的向量索引
 *
 * 一行 = 一个可索引对象（表 或 列），用于"用关键词找到最相关的表"
 * - kind: 'table' 表级（基于 schema.table.description）
 * - kind: 'column' 列级（基于 column_name + business_name + description）
 *
 * embedding 维度按 OpenAI text-embedding-3-small (1536) 设计，
 * 实际存储用 jsonb（兼容无 pgvector 环境）；有 pgvector 时上 vector 索引会更快。
 */
@Entity({ name: 'schema_embeddings', schema: 'app' })
@Index('idx_schema_emb_ds', ['datasourceId'])
@Index('idx_schema_emb_kind', ['kind'])
export class SchemaEmbedding {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'datasource_id', type: 'uuid' })
  datasourceId: string;

  /** 'table' | 'column' */
  @Column({ type: 'varchar', length: 20 })
  kind: 'table' | 'column';

  @Column({ name: 'schema_name', type: 'varchar', length: 100 })
  schemaName: string;

  @Column({ name: 'table_name', type: 'varchar', length: 200 })
  tableName: string;

  /** column 才有 */
  @Column({ name: 'column_name', type: 'varchar', length: 200, nullable: true })
  columnName?: string;

  /** 原始文本（被 embed 的内容），用于人类调试 */
  @Column({ name: 'text', type: 'text' })
  text: string;

  /** 向量；维度 1536 (OpenAI text-embedding-3-small) */
  @Column({ type: 'jsonb' })
  embedding: number[];

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
