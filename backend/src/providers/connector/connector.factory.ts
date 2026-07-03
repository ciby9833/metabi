import { Injectable, Logger } from '@nestjs/common';
import { BaseConnector } from './connectors/base.connector';
import { PostgresConnector } from './connectors/postgresql.connector';
import { MySQLConnector } from './connectors/mysql.connector';
import { ConnectorConfig } from './types';
import { DatasourceType } from '../../database/entities';

/**
 * 连接器工厂 - 缓存复用连接，避免每次请求新建连接池
 */
@Injectable()
export class ConnectorFactory {
  private readonly logger = new Logger(ConnectorFactory.name);
  private readonly connectorCache = new Map<string, BaseConnector>();

  /**
   * 通过数据源 ID 获取连接器，自动缓存
   */
  getConnector(datasourceId: string, type: string, config: ConnectorConfig): BaseConnector {
    const cacheKey = `${datasourceId}:${type}`;
    if (this.connectorCache.has(cacheKey)) {
      return this.connectorCache.get(cacheKey) as BaseConnector;
    }

    const connector = this.createConnector(type, config);
    this.connectorCache.set(cacheKey, connector);
    this.logger.log(`Created connector ${cacheKey}`);
    return connector;
  }

  /**
   * 创建临时连接器（不缓存，例如连接测试场景）
   */
  createConnector(type: string, config: ConnectorConfig): BaseConnector {
    switch (type) {
      case DatasourceType.POSTGRESQL:
        return new PostgresConnector(config);
      case DatasourceType.MYSQL:
        return new MySQLConnector(config);
      default:
        throw new Error(`Unsupported datasource type: ${type}`);
    }
  }

  /** 关闭所有缓存的连接器 */
  async closeAll(): Promise<void> {
    for (const [key, connector] of this.connectorCache.entries()) {
      try {
        await connector.close();
        this.logger.debug(`Closed connector ${key}`);
      } catch (err) {
        this.logger.warn(`Failed to close ${key}: ${(err as Error).message}`);
      }
    }
    this.connectorCache.clear();
  }

  /** 移除特定连接器（例如数据源更新或删除时调用）*/
  removeConnector(datasourceId: string, type: string): void {
    const cacheKey = `${datasourceId}:${type}`;
    const connector = this.connectorCache.get(cacheKey);
    if (connector) {
      connector.close().catch(() => undefined);
      this.connectorCache.delete(cacheKey);
    }
  }
}
