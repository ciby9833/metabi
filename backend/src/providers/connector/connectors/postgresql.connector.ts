import { Pool, PoolClient } from 'pg';
import { BaseConnector } from './base.connector';
import {
  ColumnInfo,
  ConnectionTestResult,
  ConnectorConfig,
  ExecuteOptions,
  QueryResult,
  TableSchema,
  TableStats,
} from '../types';

export class PostgresConnector extends BaseConnector {
  private pool: Pool;

  constructor(config: ConnectorConfig) {
    super(config);
    this.pool = new Pool({
      host: config.host,
      port: config.port,
      database: config.database,
      user: config.username,
      password: config.password,
      ssl: config.ssl ? { rejectUnauthorized: false } : false,
      max: config.poolMax || 10,
      min: config.poolMin || 0,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 10000,
    });
  }

  get type(): string {
    return 'postgresql';
  }

  async testConnection(): Promise<ConnectionTestResult> {
    const start = Date.now();
    let client: PoolClient | undefined;
    try {
      client = await this.pool.connect();
      const res = await client.query('SELECT version() as version');
      return {
        success: true,
        message: 'Connection successful',
        serverVersion: res.rows[0]?.version,
        latencyMs: Date.now() - start,
      };
    } catch (err) {
      return {
        success: false,
        message: (err as Error).message,
        latencyMs: Date.now() - start,
      };
    } finally {
      client?.release();
    }
  }

  async execute(sql: string, options?: ExecuteOptions): Promise<QueryResult> {
    const start = Date.now();
    const maxRows = options?.maxRows || 1000;
    const timeoutSec = options?.timeoutSec || 30;

    const client = await this.pool.connect();
    try {
      // 设置 statement_timeout（毫秒）
      await client.query(`SET statement_timeout = ${timeoutSec * 1000}`);

      const result = await client.query({
        text: sql,
        rowMode: 'array',
      });

      const columns: ColumnInfo[] = (result.fields || []).map((f) => ({
        name: f.name,
        type: this.mapPgType(f.dataTypeID),
      }));

      const rows: Record<string, any>[] = (result.rows as any[][]).slice(0, maxRows).map((row) => {
        const obj: Record<string, any> = {};
        columns.forEach((col, idx) => {
          obj[col.name] = row[idx];
        });
        return obj;
      });

      return {
        columns,
        rows,
        rowCount: result.rowCount || rows.length,
        truncated: (result.rowCount || 0) > maxRows,
        executionTimeMs: Date.now() - start,
      };
    } finally {
      client.release();
    }
  }

  async listTables(schema = 'public'): Promise<string[]> {
    const sql = `
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = $1 AND table_type = 'BASE TABLE'
      ORDER BY table_name
    `;
    const result = await this.pool.query(sql, [schema]);
    return result.rows.map((r) => r.table_name);
  }

  async describeTable(table: string, schema = 'public'): Promise<TableSchema> {
    const sql = `
      SELECT column_name, data_type, is_nullable
      FROM information_schema.columns
      WHERE table_schema = $1 AND table_name = $2
      ORDER BY ordinal_position
    `;
    const result = await this.pool.query(sql, [schema, table]);
    const columns: ColumnInfo[] = result.rows.map((r) => ({
      name: r.column_name,
      type: r.data_type,
      nullable: r.is_nullable === 'YES',
    }));
    return { name: table, schema, columns };
  }

  async getTableStats(table: string, schema = 'public'): Promise<TableStats | null> {
    try {
      const sql = `
        SELECT
          s.schemaname,
          s.relname,
          s.n_live_tup AS estimated_rows,
          pg_total_relation_size(quote_ident(s.schemaname) || '.' || quote_ident(s.relname)) AS size_bytes,
          GREATEST(s.last_autoanalyze, s.last_analyze) AS last_analyzed,
          GREATEST(
            s.last_autovacuum,
            s.last_vacuum,
            s.last_autoanalyze,
            s.last_analyze
          ) AS last_activity
        FROM pg_stat_user_tables s
        WHERE s.schemaname = $1 AND s.relname = $2
      `;
      const res = await this.pool.query(sql, [schema, table]);
      if (res.rows.length === 0) return null;
      const r = res.rows[0];
      return {
        schema,
        table,
        estimatedRowCount: r.estimated_rows != null ? Number(r.estimated_rows) : undefined,
        sizeBytes: r.size_bytes != null ? Number(r.size_bytes) : undefined,
        lastActivityAt: r.last_activity ? new Date(r.last_activity) : undefined,
        lastAnalyzedAt: r.last_analyzed ? new Date(r.last_analyzed) : undefined,
      };
    } catch {
      return null; // 权限不足 / 视图不存在等场景静默忽略
    }
  }

  async close(): Promise<void> {
    await this.pool.end();
  }

  /** PostgreSQL OID → type name 的简化映射 */
  private mapPgType(oid: number): string {
    const map: Record<number, string> = {
      16: 'boolean',
      20: 'bigint',
      21: 'smallint',
      23: 'integer',
      25: 'text',
      700: 'real',
      701: 'double precision',
      1043: 'varchar',
      1082: 'date',
      1114: 'timestamp',
      1184: 'timestamptz',
      1700: 'numeric',
      114: 'json',
      3802: 'jsonb',
      2950: 'uuid',
    };
    return map[oid] || `oid:${oid}`;
  }
}
