import { Inject, Injectable, Logger } from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Cache } from 'cache-manager';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as crypto from 'crypto';
import { ConnectorFactory } from '../../providers/connector/connector.factory';
import { QueryResult } from '../../providers/connector/types';
import { SqlRecord, SqlExecutionStatus, Datasource } from '../../database/entities';
import { SqlSafetyService } from './sql-safety.service';

export interface ExecuteSqlOptions {
  conversationId?: string;
  userId?: string;
  question?: string;
  maxRows?: number;
  timeoutSec?: number;
  useCache?: boolean;
}

export interface ExecuteSqlResponse extends QueryResult {
  fromCache: boolean;
  recordId?: string;
}

/**
 * SQL 执行引擎
 *
 * 职责：
 *  - 安全检查（SqlSafetyService）
 *  - 路由到对应连接器
 *  - 限制行数与超时
 *  - Redis 结果缓存
 *  - 审计日志写入 sql_records
 */
@Injectable()
export class SqlExecutorService {
  private readonly logger = new Logger(SqlExecutorService.name);
  private readonly defaultMaxRows: number;
  private readonly defaultTimeoutSec: number;
  private readonly defaultCacheTtl: number;

  constructor(
    private readonly configService: ConfigService,
    private readonly safety: SqlSafetyService,
    private readonly connectorFactory: ConnectorFactory,
    @Inject(CACHE_MANAGER) private readonly cache: Cache,
    @InjectRepository(SqlRecord)
    private readonly sqlRecordRepo: Repository<SqlRecord>,
    @InjectRepository(Datasource)
    private readonly datasourceRepo: Repository<Datasource>,
  ) {
    this.defaultMaxRows = this.configService.get<number>('app.sql.maxRows') || 1000;
    this.defaultTimeoutSec = this.configService.get<number>('app.sql.timeout') || 30;
    this.defaultCacheTtl = this.configService.get<number>('app.sql.cacheTtl') || 3600;
  }

  async execute(
    sql: string,
    datasourceId: string,
    options?: ExecuteSqlOptions,
  ): Promise<ExecuteSqlResponse> {
    const maxRows = options?.maxRows || this.defaultMaxRows;
    const timeoutSec = options?.timeoutSec || this.defaultTimeoutSec;
    const useCache = options?.useCache !== false;

    // 1) 安全检查
    this.safety.validate(sql);

    // 2) 自动加 LIMIT
    const safeSql = this.safety.ensureLimit(sql, maxRows);

    // 3) 缓存检查
    const cacheKey = this.buildCacheKey(safeSql, datasourceId);
    if (useCache) {
      const cached = await this.cache.get<ExecuteSqlResponse>(cacheKey);
      if (cached) {
        this.logger.debug(`SQL cache hit: ${cacheKey.substring(0, 16)}...`);
        await this.writeAudit({
          sql: safeSql,
          datasourceId,
          status: SqlExecutionStatus.SUCCESS,
          executionTimeMs: 0,
          resultRows: cached.rowCount,
          fromCache: true,
          conversationId: options?.conversationId,
          userId: options?.userId,
          question: options?.question,
        });
        return { ...cached, fromCache: true };
      }
    }

    // 4) 加载数据源连接器
    const datasource = await this.datasourceRepo.findOne({ where: { id: datasourceId } });
    if (!datasource) {
      throw new Error(`Datasource not found: ${datasourceId}`);
    }
    const connector = this.connectorFactory.getConnector(
      datasource.id,
      datasource.type,
      datasource.config as any,
    );

    // 5) 执行
    let result: QueryResult;
    try {
      result = await connector.execute(safeSql, { maxRows, timeoutSec });
    } catch (err) {
      const message = (err as Error).message;
      this.logger.error(`SQL execution failed: ${message}`);
      await this.writeAudit({
        sql: safeSql,
        datasourceId,
        status: message.toLowerCase().includes('timeout')
          ? SqlExecutionStatus.TIMEOUT
          : SqlExecutionStatus.ERROR,
        errorMessage: message,
        conversationId: options?.conversationId,
        userId: options?.userId,
        question: options?.question,
        fromCache: false,
      });
      throw err;
    }

    // 6) 写入缓存
    if (useCache) {
      await this.cache.set(cacheKey, result, this.defaultCacheTtl);
    }

    // 7) 写入审计日志
    const record = await this.writeAudit({
      sql: safeSql,
      datasourceId,
      status: SqlExecutionStatus.SUCCESS,
      executionTimeMs: result.executionTimeMs,
      resultRows: result.rowCount,
      fromCache: false,
      conversationId: options?.conversationId,
      userId: options?.userId,
      question: options?.question,
    });

    return { ...result, fromCache: false, recordId: record?.id };
  }

  private buildCacheKey(sql: string, datasourceId: string): string {
    const hash = crypto.createHash('sha256').update(`${datasourceId}:${sql}`).digest('hex');
    return `sql:result:${hash}`;
  }

  private async writeAudit(payload: {
    sql: string;
    datasourceId: string;
    status: SqlExecutionStatus;
    executionTimeMs?: number;
    resultRows?: number;
    errorMessage?: string;
    fromCache: boolean;
    conversationId?: string;
    userId?: string;
    question?: string;
  }): Promise<SqlRecord | null> {
    try {
      const record = this.sqlRecordRepo.create({
        sqlText: payload.sql,
        datasourceId: payload.datasourceId,
        status: payload.status,
        executionTimeMs: payload.executionTimeMs,
        resultRows: payload.resultRows,
        errorMessage: payload.errorMessage,
        fromCache: payload.fromCache,
        conversationId: payload.conversationId,
        userId: payload.userId,
        question: payload.question,
      });
      return await this.sqlRecordRepo.save(record);
    } catch (err) {
      this.logger.warn(`Failed to write SQL audit log: ${(err as Error).message}`);
      return null;
    }
  }
}
