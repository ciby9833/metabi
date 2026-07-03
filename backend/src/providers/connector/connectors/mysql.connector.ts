import { BaseConnector } from './base.connector';
import {
  ConnectionTestResult,
  ConnectorConfig,
  ExecuteOptions,
  QueryResult,
  TableSchema,
} from '../types';

/**
 * MySQL Connector
 *
 * 注意：MVP 阶段未引入 mysql2 包，此实现使用懒加载方式。
 * 实际使用前请运行：npm install mysql2
 */
export class MySQLConnector extends BaseConnector {
  private pool: any = null;

  constructor(config: ConnectorConfig) {
    super(config);
  }

  get type(): string {
    return 'mysql';
  }

  private async ensurePool(): Promise<any> {
    if (this.pool) return this.pool;
    let mysql: any;
    try {
      mysql = await import('mysql2/promise');
    } catch {
      throw new Error(
        'mysql2 package is not installed. Run: npm install mysql2',
      );
    }
    this.pool = mysql.createPool({
      host: this.config.host,
      port: this.config.port,
      database: this.config.database,
      user: this.config.username,
      password: this.config.password,
      connectionLimit: this.config.poolMax || 10,
      ssl: this.config.ssl ? {} : undefined,
    });
    return this.pool;
  }

  async testConnection(): Promise<ConnectionTestResult> {
    const start = Date.now();
    try {
      const pool = await this.ensurePool();
      const [rows]: any = await pool.query('SELECT VERSION() as version');
      return {
        success: true,
        message: 'Connection successful',
        serverVersion: rows?.[0]?.version,
        latencyMs: Date.now() - start,
      };
    } catch (err) {
      return {
        success: false,
        message: (err as Error).message,
        latencyMs: Date.now() - start,
      };
    }
  }

  async execute(sql: string, options?: ExecuteOptions): Promise<QueryResult> {
    const start = Date.now();
    const maxRows = options?.maxRows || 1000;
    const pool = await this.ensurePool();

    const [rows, fields]: any = await pool.query(sql);
    const columns = (fields as any[]).map((f) => ({
      name: f.name,
      type: f.type,
    }));
    const dataRows = (rows as Record<string, any>[]).slice(0, maxRows);

    return {
      columns,
      rows: dataRows,
      rowCount: rows.length,
      truncated: rows.length > maxRows,
      executionTimeMs: Date.now() - start,
    };
  }

  async listTables(schema?: string): Promise<string[]> {
    const pool = await this.ensurePool();
    const db = schema || this.config.database;
    const [rows]: any = await pool.query(
      'SELECT table_name as name FROM information_schema.tables WHERE table_schema = ?',
      [db],
    );
    return rows.map((r: any) => r.name || r.TABLE_NAME);
  }

  async describeTable(table: string, schema?: string): Promise<TableSchema> {
    const pool = await this.ensurePool();
    const db = schema || this.config.database;
    const [rows]: any = await pool.query(
      `SELECT column_name as name, data_type as type, is_nullable as nullable
       FROM information_schema.columns
       WHERE table_schema = ? AND table_name = ?
       ORDER BY ordinal_position`,
      [db, table],
    );
    return {
      name: table,
      schema: db,
      columns: rows.map((r: any) => ({
        name: r.name || r.COLUMN_NAME,
        type: r.type || r.DATA_TYPE,
        nullable: (r.nullable || r.IS_NULLABLE) === 'YES',
      })),
    };
  }

  async close(): Promise<void> {
    if (this.pool) {
      await this.pool.end();
      this.pool = null;
    }
  }
}
