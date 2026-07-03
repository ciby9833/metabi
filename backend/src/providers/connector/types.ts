/**
 * 数据连接器通用类型
 */

export interface ConnectorConfig {
  type: string;
  host: string;
  port: number;
  database: string;
  username: string;
  password: string;
  schema?: string;
  ssl?: boolean;
  poolMax?: number;
  poolMin?: number;
}

export interface QueryResult {
  columns: ColumnInfo[];
  rows: Record<string, any>[];
  rowCount: number;
  truncated: boolean;
  executionTimeMs: number;
}

export interface ColumnInfo {
  name: string;
  type: string;
  nullable?: boolean;
}

export interface TableSchema {
  name: string;
  schema?: string;
  columns: ColumnInfo[];
  rowCount?: number;
}

/**
 * 表的"活体"统计 —— 用于血缘 badge / 数据新鲜度感知
 * 字段都是可选的：不同数据库 / 不同权限下能拿到的程度不一样
 */
export interface TableStats {
  schema: string;
  table: string;
  /** 估算行数（系统视图，便宜，可能略不准）*/
  estimatedRowCount?: number;
  /** 总占用空间（字节） */
  sizeBytes?: number;
  /** 最后一次写入活动时间（INSERT/UPDATE/DELETE 估算）*/
  lastActivityAt?: Date;
  /** 最后一次 ANALYZE / VACUUM 时间 */
  lastAnalyzedAt?: Date;
}

export interface ConnectionTestResult {
  success: boolean;
  message: string;
  serverVersion?: string;
  latencyMs?: number;
}

export interface ExecuteOptions {
  /** 最大返回行数 */
  maxRows?: number;
  /** 查询超时（秒）*/
  timeoutSec?: number;
}
