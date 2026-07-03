import { Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { DatasetColumn } from '../../../database/entities';

const USER_DATA_SCHEMA = 'user_data';
/** 批量插入分块大小 — 平衡速度和内存 */
const COPY_CHUNK_SIZE = 1000;

/**
 * 把解析好的数据（已用户确认的 schema + allRows）导入 user_data.<table_name>。
 *
 * 流程：
 *   1) CREATE TABLE user_data.<table_name>(...)
 *   2) 分块 INSERT（用 parameterized statement，避免 SQL injection）
 *   3) ANALYZE 让 PG 统计该表，后续 EXPLAIN 准确
 *
 * 注意：本服务不做 ownerId / projectId 校验 — 那是上游 service 的责任。
 */
@Injectable()
export class DatasetImportService {
  private readonly logger = new Logger(DatasetImportService.name);

  constructor(@InjectDataSource() private readonly ds: DataSource) {}

  async createTableAndImport(
    tableName: string,
    columns: DatasetColumn[],
    rows: Record<string, any>[],
  ): Promise<{ rowCount: number; durationMs: number }> {
    const t0 = Date.now();

    // 1) 保证 schema 存在（migration 已建，这里幂等）
    await this.ds.query(`CREATE SCHEMA IF NOT EXISTS ${USER_DATA_SCHEMA};`);

    // 2) 校验表名 — 只允许 ds_ + 32 个 hex（uuid 去 -）
    if (!/^ds_[a-f0-9]{32}$/.test(tableName)) {
      throw new Error(`Invalid table name: ${tableName}`);
    }

    // 3) DROP 重建（避免冲突；用户 confirm 阶段可能重试）
    const fullName = `${USER_DATA_SCHEMA}.${tableName}`;
    await this.ds.query(`DROP TABLE IF EXISTS ${fullName};`);

    // 4) CREATE TABLE
    const activeCols = columns.filter((c) => !c.skipped);
    if (activeCols.length === 0) {
      throw new Error('No columns to import (all skipped?)');
    }
    const colDefs = activeCols.map((c) => `"${c.name}" ${this.pgType(c.type)}`).join(', ');
    await this.ds.query(`CREATE TABLE ${fullName} (${colDefs});`);

    // 5) 分块插入
    let inserted = 0;
    for (let i = 0; i < rows.length; i += COPY_CHUNK_SIZE) {
      const chunk = rows.slice(i, i + COPY_CHUNK_SIZE);
      await this.insertChunk(fullName, activeCols, chunk);
      inserted += chunk.length;
    }

    // 6) ANALYZE
    await this.ds.query(`ANALYZE ${fullName};`);

    const durationMs = Date.now() - t0;
    this.logger.log(
      `Imported ${inserted} rows into ${fullName} (${columns.length} cols, ${durationMs}ms)`,
    );
    return { rowCount: inserted, durationMs };
  }

  /** 删除 dataset 表（删 dataset 时调用）*/
  async dropTable(tableName: string): Promise<void> {
    if (!/^ds_[a-f0-9]{32}$/.test(tableName)) {
      this.logger.warn(`Refusing to drop invalid table name: ${tableName}`);
      return;
    }
    await this.ds.query(`DROP TABLE IF EXISTS ${USER_DATA_SCHEMA}.${tableName};`);
  }

  // ============ helpers ============

  /** 把我们的列类型映射到 PG 列类型 */
  private pgType(t: DatasetColumn['type']): string {
    switch (t) {
      case 'integer':
        return 'integer';
      case 'numeric':
        return 'numeric';
      case 'boolean':
        return 'boolean';
      case 'timestamp':
        return 'timestamp without time zone';
      case 'date':
        return 'date';
      case 'text':
      default:
        return 'text';
    }
  }

  /** parameterized 批量 INSERT —— 单 statement N 行，N <= COPY_CHUNK_SIZE */
  private async insertChunk(
    fullName: string,
    cols: DatasetColumn[],
    chunk: Record<string, any>[],
  ): Promise<void> {
    const colNames = cols.map((c) => `"${c.name}"`).join(', ');
    const placeholders: string[] = [];
    const params: any[] = [];
    let paramIdx = 1;

    for (const row of chunk) {
      const phs = cols.map(() => `$${paramIdx++}`);
      placeholders.push(`(${phs.join(', ')})`);
      for (const c of cols) {
        params.push(this.coerce(row[c.name], c.type));
      }
    }

    const sql = `INSERT INTO ${fullName} (${colNames}) VALUES ${placeholders.join(', ')};`;
    await this.ds.query(sql, params);
  }

  /** 把字符串数据按目标类型强转 — 失败回退 null（不阻断 import）*/
  private coerce(value: any, type: DatasetColumn['type']): any {
    if (value == null || value === '') return null;
    if (typeof value === 'string') {
      const t = value.trim();
      if (t === '' || /^(null|n\/a|na|nil|-)$/i.test(t)) return null;
    }
    try {
      switch (type) {
        case 'integer': {
          const n = parseInt(String(value), 10);
          return Number.isFinite(n) ? n : null;
        }
        case 'numeric': {
          const n = parseFloat(String(value));
          return Number.isFinite(n) ? n : null;
        }
        case 'boolean': {
          const s = String(value).trim().toLowerCase();
          if (['true', 'yes', '1', '是'].includes(s)) return true;
          if (['false', 'no', '0', '否'].includes(s)) return false;
          return null;
        }
        case 'timestamp':
        case 'date': {
          const d = new Date(value);
          return isNaN(d.getTime()) ? null : d.toISOString();
        }
        case 'text':
        default:
          return String(value);
      }
    } catch {
      return null;
    }
  }
}
