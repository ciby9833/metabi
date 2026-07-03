import {
  ConnectionTestResult,
  ConnectorConfig,
  ExecuteOptions,
  QueryResult,
  TableSchema,
  TableStats,
} from '../types';

/**
 * 数据连接器基类
 * 所有具体连接器（PostgreSQL/MySQL/ClickHouse）必须继承此类
 */
export abstract class BaseConnector {
  protected readonly config: ConnectorConfig;

  constructor(config: ConnectorConfig) {
    this.config = config;
  }

  abstract get type(): string;

  /** 测试连接 */
  abstract testConnection(): Promise<ConnectionTestResult>;

  /** 执行 SQL（只读）*/
  abstract execute(sql: string, options?: ExecuteOptions): Promise<QueryResult>;

  /** 列出所有表 */
  abstract listTables(schema?: string): Promise<string[]>;

  /** 获取表的 schema */
  abstract describeTable(table: string, schema?: string): Promise<TableSchema>;

  /**
   * 表"活体"统计：行数估计、大小、最近写入活动
   * 默认返回 null（具体 connector 自行实现）
   */
  async getTableStats(_table: string, _schema?: string): Promise<TableStats | null> {
    return null;
  }

  /** 关闭连接 */
  abstract close(): Promise<void>;
}
