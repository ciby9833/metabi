import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

/**
 * 用户上传的数据集（自助分析）— 与企业级 Datasource（DB 连接）独立。
 *
 * 物理存储：每个 dataset 对应 user_data schema 下的一张物理表 user_data.ds_<id>。
 *
 * 权限模型（4 层防御）：
 *   1) API 层：ownerId 校验 + Project member 校验
 *   2) Chat 时 ToolContext.allowedTables 仅注入该用户/项目可见的 dataset 表
 *   3) SQL Engine 检查 allowedTables 白名单
 *   4) DB role chatbi_user_data 限制只对 user_data schema 有 SELECT/INSERT 权
 *
 * Project 归属：
 *   - projectId = null → Personal（仅 owner 可访问）
 *   - projectId 非空 → Project member 都可访问（按 role）
 *
 * 状态机：
 *   pending → parsing → awaiting_confirm → importing → ready
 *                  ↓                    ↓
 *                failed                failed
 */
export type DatasetStatus =
  | 'pending'              // 文件上传完，待解析
  | 'parsing'              // 正在解析 + 类型推断
  | 'awaiting_confirm'     // 推断完成，等用户确认 schema
  | 'importing'            // 正在 COPY 数据到 PG
  | 'ready'                // 可以被 chat 查询
  | 'failed';

/** 推断 / 用户确认后的列 schema */
export interface DatasetColumn {
  /** 入库的实际列名（已 sanitize，小写 + 下划线，无中文）*/
  name: string;
  /** 用户友好的原始列名（如"客户姓名"）*/
  originalName?: string;
  /** PG 类型 */
  type: 'text' | 'integer' | 'numeric' | 'boolean' | 'timestamp' | 'date';
  /** 业务描述 — 由用户填写或 AI 建议，注入 Planner prompt 时用 */
  description?: string;
  /** 前 5 行样本（供 schema 确认页展示）*/
  sample?: any[];
  /** 空值占比 0..1 */
  nullRatio?: number;
  /** 是否被用户跳过（不入库）*/
  skipped?: boolean;
}

@Entity({ name: 'user_datasets' })
@Index('idx_user_dataset_owner', ['ownerId'])
@Index('idx_user_dataset_project', ['projectId'])
@Index('idx_user_dataset_status', ['status'])
export class UserDataset {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** 上传者（永远是 owner，转移不变）*/
  @Column({ type: 'uuid', name: 'owner_id' })
  ownerId: string;

  /**
   * 项目归属（必填，学 Claude Project Knowledge）：
   *   Personal Workspace project（默认）→ 仅 owner 看
   *   普通 Project → project member 按 role 看
   * 改归属 = 转移到另一个 project（前端二次确认）。
   */
  @Column({ type: 'uuid', name: 'project_id' })
  projectId: string;

  /** 原始文件名（如 "客户名单.csv"），展示用 */
  @Column({ type: 'varchar', length: 255, name: 'source_filename' })
  sourceFilename: string;

  /** 原始文件大小（bytes）*/
  @Column({ type: 'bigint', name: 'source_size_bytes' })
  sourceSizeBytes: number;

  /** MIME 类型（text/csv / application/vnd.openxmlformats-...） */
  @Column({ type: 'varchar', length: 100, name: 'source_mime' })
  sourceMime: string;

  /**
   * 入库后的 PG 表名（不含 schema 前缀），如 'ds_a1b2c3d4'。
   * 完整 SQL 路径 = user_data.<table_name>
   */
  @Column({ type: 'varchar', length: 63, name: 'table_name', nullable: true })
  tableName: string | null;

  /** 用户友好的展示名（默认 = filename 去掉扩展名，可改）*/
  @Column({ type: 'varchar', length: 255, name: 'display_name' })
  displayName: string;

  /** 业务描述（用户填写，注入 Planner prompt）*/
  @Column({ type: 'text', nullable: true })
  description: string | null;

  /** 列 schema（推断 + 用户确认后的）*/
  @Column({ type: 'jsonb', nullable: true })
  columns: DatasetColumn[] | null;

  /** 行数（入库后填）*/
  @Column({ type: 'integer', name: 'row_count', nullable: true })
  rowCount: number | null;

  @Column({ type: 'varchar', length: 32, default: 'pending' })
  status: DatasetStatus;

  /** 失败时的错误信息 */
  @Column({ type: 'text', name: 'error_message', nullable: true })
  errorMessage: string | null;

  /** 临时存储路径（解析完成或失败后清掉）*/
  @Column({ type: 'text', name: 'temp_file_path', nullable: true })
  tempFilePath: string | null;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at' })
  updatedAt: Date;
}
