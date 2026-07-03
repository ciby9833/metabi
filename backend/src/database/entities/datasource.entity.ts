import { Entity, Column, Index } from 'typeorm';
import { BaseEntity } from './base.entity';

export enum DatasourceType {
  POSTGRESQL = 'postgresql',
  MYSQL = 'mysql',
  CLICKHOUSE = 'clickhouse',
  API = 'api',
  CSV = 'csv',
  EXCEL = 'excel',
}

@Entity({ name: 'datasources', schema: 'app' })
export class Datasource extends BaseEntity {
  @Column({ type: 'varchar', length: 255 })
  name: string;

  @Column({ type: 'varchar', length: 50 })
  type: DatasourceType;

  @Column({ type: 'text', nullable: true })
  description?: string;

  // 连接配置 (敏感数据应加密存储)
  @Column({ type: 'jsonb' })
  config: Record<string, any>;

  @Column({ name: 'owner_id', type: 'uuid', nullable: true })
  ownerId?: string;

  @Index()
  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean;

  // 关联的语义层数据集 (YAML 文件中的 dataset 名称)
  @Column({ name: 'dataset_names', type: 'text', array: true, default: '{}' })
  datasetNames: string[];
}
