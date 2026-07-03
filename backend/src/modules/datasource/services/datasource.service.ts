import { ForbiddenException, Injectable, NotFoundException, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Datasource } from '../../../database/entities';
import { ConnectorFactory } from '../../../providers/connector/connector.factory';
import { CreateDatasourceDto, TestConnectionDto, UpdateDatasourceDto } from '../dto/datasource.dto';

@Injectable()
export class DatasourceService {
  private readonly logger = new Logger(DatasourceService.name);

  constructor(
    @InjectRepository(Datasource)
    private readonly datasourceRepo: Repository<Datasource>,
    private readonly connectorFactory: ConnectorFactory,
  ) {}

  /** 只列当前用户拥有 / 历史无 owner 的（向后兼容） */
  async list(ownerId: string) {
    const items = await this.datasourceRepo
      .createQueryBuilder('d')
      .where('d.owner_id = :uid OR d.owner_id IS NULL', { uid: ownerId })
      .orderBy('d.created_at', 'DESC')
      .getMany();
    return { data: items, total: items.length };
  }

  async create(dto: CreateDatasourceDto, ownerId: string) {
    const entity = this.datasourceRepo.create({
      name: dto.name,
      type: dto.type,
      description: dto.description,
      config: dto.config,
      ownerId,
      datasetNames: dto.datasetNames || [],
    });
    return this.datasourceRepo.save(entity);
  }

  async getById(id: string, ownerId?: string) {
    const item = await this.datasourceRepo.findOne({ where: { id } });
    if (!item) throw new NotFoundException(`Datasource ${id} not found`);
    if (ownerId && item.ownerId && item.ownerId !== ownerId) {
      throw new ForbiddenException('无权访问该数据源');
    }
    return item;
  }

  async update(id: string, dto: UpdateDatasourceDto, ownerId: string) {
    const existing = await this.getById(id, ownerId);
    Object.assign(existing, dto);
    const saved = await this.datasourceRepo.save(existing);
    // 配置变更后失效连接池缓存
    this.connectorFactory.removeConnector(id, existing.type);
    return saved;
  }

  async delete(id: string, ownerId: string) {
    const existing = await this.getById(id, ownerId);
    await this.datasourceRepo.delete(id);
    this.connectorFactory.removeConnector(id, existing.type);
  }

  /** 测试连接（不保存数据源）*/
  async testConnection(dto: TestConnectionDto) {
    const connector = this.connectorFactory.createConnector(dto.type, dto.config as any);
    try {
      const result = await connector.testConnection();
      return result;
    } finally {
      await connector.close().catch(() => undefined);
    }
  }

  /** 获取数据源的所有表 */
  async listTables(id: string, ownerId: string, schema?: string) {
    const ds = await this.getById(id, ownerId);
    const connector = this.connectorFactory.getConnector(ds.id, ds.type, ds.config as any);
    return connector.listTables(schema || (ds.config as any)?.schema);
  }

  /** 获取数据源表结构 */
  async describeTable(id: string, table: string, ownerId: string, schema?: string) {
    const ds = await this.getById(id, ownerId);
    const connector = this.connectorFactory.getConnector(ds.id, ds.type, ds.config as any);
    return connector.describeTable(table, schema || (ds.config as any)?.schema);
  }

  /**
   * 批量描述多张表的字段（供前端 @ 联想用）
   * 每张表并发拉；单张失败不阻断其他
   */
  async describeMany(
    id: string,
    tables: string[],
    ownerId: string,
    schema?: string,
  ): Promise<Record<string, Array<{ name: string; type: string; nullable?: boolean }>>> {
    const ds = await this.getById(id, ownerId);
    const connector = this.connectorFactory.getConnector(ds.id, ds.type, ds.config as any);
    const effectiveSchema = schema || (ds.config as any)?.schema;
    const out: Record<string, Array<{ name: string; type: string; nullable?: boolean }>> = {};
    await Promise.all(
      tables.slice(0, 20).map(async (t) => {
        try {
          // 表名带 schema 前缀（如 "dwd.orders"）→ 提取 schema 和 bare
          // 不带前缀 → 用 datasource 默认 schema
          const [tableSchemaName, bare] = t.includes('.')
            ? [t.split('.')[0], t.split('.').slice(1).join('.')]
            : [effectiveSchema, t];
          const result = await connector.describeTable(bare, tableSchemaName);
          out[t] = (result.columns || []).map((c) => ({
            name: c.name,
            type: c.type,
            nullable: c.nullable,
          }));
        } catch (err) {
          this.logger.warn(
            `describeMany failed for "${t}": ${(err as Error).message}`,
          );
          out[t] = [];
        }
      }),
    );
    return out;
  }
}
