import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Datasource, DatasourceMetadata, SchemaEmbedding } from '../../database/entities';
import { ConnectorFactory } from '../connector/connector.factory';
import { LLMGatewayService } from '../llm/llm-gateway.service';

interface SearchResult {
  schemaName: string;
  tableName: string;
  columnName?: string;
  text: string;
  score: number;
  kind: 'table' | 'column';
}

/**
 * SchemaIndex 服务
 *
 * 1. reindex(datasourceId)：抓数据源全部表/列 → embed → 存 schema_embeddings
 * 2. search(datasourceId, query, k)：用户问题 embed → 余弦相似度 → Top-k 表/列
 *
 * 大型数据库（1000+ 表）场景下，避免 list_tables 把全部表清单塞给 LLM
 */
@Injectable()
export class SchemaIndexService {
  private readonly logger = new Logger(SchemaIndexService.name);

  constructor(
    @InjectRepository(SchemaEmbedding)
    private readonly embRepo: Repository<SchemaEmbedding>,
    @InjectRepository(Datasource)
    private readonly dsRepo: Repository<Datasource>,
    @InjectRepository(DatasourceMetadata)
    private readonly metaRepo: Repository<DatasourceMetadata>,
    private readonly connectorFactory: ConnectorFactory,
    private readonly llm: LLMGatewayService,
  ) {}

  /**
   * 重建某数据源的 schema 索引
   * - 列出全部表 → describe_table → 拼接文本 → embed
   * - 同时把元数据里的业务名/描述拼进去（如果有）
   */
  async reindex(datasourceId: string): Promise<{ tables: number; columns: number }> {
    const ds = await this.dsRepo.findOneOrFail({ where: { id: datasourceId } });
    const connector = this.connectorFactory.getConnector(ds.id, ds.type, ds.config as any);
    const schema = (ds.config as any)?.schema || 'public';
    const allMeta = await this.metaRepo.find({ where: { datasourceId } });
    const metaByTable = new Map<string, DatasourceMetadata>();
    const metaByCol = new Map<string, DatasourceMetadata>();
    for (const m of allMeta) {
      if (!m.columnName) metaByTable.set(m.tableName, m);
      else metaByCol.set(`${m.tableName}.${m.columnName}`, m);
    }

    // 清空旧索引
    await this.embRepo.delete({ datasourceId });

    const tables = await connector.listTables(schema);
    let tableCount = 0;
    let columnCount = 0;

    for (const tableName of tables) {
      try {
        const tableMeta = metaByTable.get(tableName);
        const tableText = this.buildTableText(schema, tableName, tableMeta);
        const tableEmb = await this.embed(tableText);
        await this.embRepo.save(
          this.embRepo.create({
            datasourceId,
            kind: 'table',
            schemaName: schema,
            tableName,
            text: tableText,
            embedding: tableEmb,
          }),
        );
        tableCount++;

        // 列级（限制每个表最多 50 列避免爆）
        const desc = await connector.describeTable(tableName, schema);
        for (const col of desc.columns.slice(0, 50)) {
          const colMeta = metaByCol.get(`${tableName}.${col.name}`);
          const colText = this.buildColumnText(tableName, col.name, col.type, colMeta);
          const colEmb = await this.embed(colText);
          await this.embRepo.save(
            this.embRepo.create({
              datasourceId,
              kind: 'column',
              schemaName: schema,
              tableName,
              columnName: col.name,
              text: colText,
              embedding: colEmb,
            }),
          );
          columnCount++;
        }
      } catch (err) {
        this.logger.warn(`Reindex table ${tableName} failed: ${(err as Error).message}`);
      }
    }
    this.logger.log(`Reindexed datasource ${datasourceId}: ${tableCount} tables, ${columnCount} columns`);
    return { tables: tableCount, columns: columnCount };
  }

  /**
   * 用户问题 → 找最相关的 Top-k 表/列
   */
  async search(datasourceId: string, query: string, k = 10): Promise<SearchResult[]> {
    const queryEmb = await this.embed(query);
    const all = await this.embRepo.find({ where: { datasourceId } });
    if (all.length === 0) return [];
    const scored = all
      .map((e) => ({
        schemaName: e.schemaName,
        tableName: e.tableName,
        columnName: e.columnName,
        text: e.text,
        kind: e.kind,
        score: this.cosine(queryEmb, e.embedding),
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, k);
    return scored;
  }

  // ============ helpers ============

  private buildTableText(schema: string, table: string, meta?: DatasourceMetadata): string {
    const parts: string[] = [`${schema}.${table}`];
    if (meta?.businessName) parts.push(`业务名: ${meta.businessName}`);
    if (meta?.description) parts.push(meta.description);
    if (meta?.synonyms?.length) parts.push(`别名: ${meta.synonyms.join(', ')}`);
    return parts.join(' | ');
  }

  private buildColumnText(
    table: string,
    column: string,
    type: string,
    meta?: DatasourceMetadata,
  ): string {
    const parts: string[] = [`${table}.${column} (${type})`];
    if (meta?.businessName) parts.push(`业务名: ${meta.businessName}`);
    if (meta?.description) parts.push(meta.description);
    if (meta?.synonyms?.length) parts.push(`别名: ${meta.synonyms.join(', ')}`);
    return parts.join(' | ');
  }

  private async embed(text: string): Promise<number[]> {
    const res = await this.llm.embed(text);
    return res.vector;
  }

  private cosine(a: number[], b: number[]): number {
    if (!a || !b || a.length !== b.length) return 0;
    let dot = 0;
    let na = 0;
    let nb = 0;
    for (let i = 0; i < a.length; i++) {
      dot += a[i] * b[i];
      na += a[i] * a[i];
      nb += b[i] * b[i];
    }
    const denom = Math.sqrt(na) * Math.sqrt(nb);
    return denom > 0 ? dot / denom : 0;
  }
}
