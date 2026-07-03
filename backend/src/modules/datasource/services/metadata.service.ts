import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import {
  DatasourceGlossary,
  DatasourceMetadata,
  SuggestedQuestion,
} from '../../../database/entities';
import {
  BatchUpsertColumnMetadataDto,
  GlossaryDto,
  SuggestedQuestionDto,
  UpsertColumnMetadataDto,
  UpsertTableMetadataDto,
} from '../dto/metadata.dto';

/**
 * 集中管理数据源元数据：表/列描述、业务术语、推荐问题
 *
 * 由 datasource 模块和 PlannerAgent 共同消费
 */
@Injectable()
export class DatasourceMetadataService {
  constructor(
    @InjectRepository(DatasourceMetadata)
    private readonly metaRepo: Repository<DatasourceMetadata>,
    @InjectRepository(DatasourceGlossary)
    private readonly glossaryRepo: Repository<DatasourceGlossary>,
    @InjectRepository(SuggestedQuestion)
    private readonly questionRepo: Repository<SuggestedQuestion>,
  ) {}

  // ============= 表级 / 列级元数据 =============

  /** 获取某数据源所有表与列的元数据 */
  async getAllForDatasource(datasourceId: string): Promise<DatasourceMetadata[]> {
    return this.metaRepo.find({
      where: { datasourceId },
      order: { tableName: 'ASC', columnName: 'ASC' },
    });
  }

  /** 获取一张表的所有元数据（含表级 + 全部列级）*/
  async getForTable(datasourceId: string, tableName: string): Promise<{
    table: DatasourceMetadata | null;
    columns: DatasourceMetadata[];
  }> {
    const all = await this.metaRepo.find({
      where: { datasourceId, tableName },
    });
    const tableMeta = all.find((m) => !m.columnName) || null;
    const columns = all.filter((m) => !!m.columnName);
    return { table: tableMeta, columns };
  }

  /** 更新表级元数据 (column_name=null) */
  async upsertTableMeta(
    datasourceId: string,
    tableName: string,
    dto: UpsertTableMetadataDto,
  ): Promise<DatasourceMetadata> {
    let row = await this.metaRepo.findOne({
      where: { datasourceId, tableName, columnName: IsNull() },
    });
    if (!row) {
      row = this.metaRepo.create({ datasourceId, tableName, columnName: null });
    }
    Object.assign(row, {
      businessName: dto.businessName ?? row.businessName,
      description: dto.description ?? row.description,
      timezone: dto.timezone ?? row.timezone,
      synonyms: dto.synonyms ?? row.synonyms ?? [],
    });
    return this.metaRepo.save(row);
  }

  /** 单列 upsert */
  async upsertColumnMeta(
    datasourceId: string,
    tableName: string,
    dto: UpsertColumnMetadataDto,
  ): Promise<DatasourceMetadata> {
    let row = await this.metaRepo.findOne({
      where: { datasourceId, tableName, columnName: dto.columnName },
    });
    if (!row) {
      row = this.metaRepo.create({
        datasourceId,
        tableName,
        columnName: dto.columnName,
      });
    }
    Object.assign(row, {
      businessName: dto.businessName ?? row.businessName,
      description: dto.description ?? row.description,
      unit: dto.unit ?? row.unit,
      synonyms: dto.synonyms ?? row.synonyms ?? [],
    });
    return this.metaRepo.save(row);
  }

  /** 批量保存多列元数据（前端一次性提交整张表）*/
  async batchUpsertColumnMeta(
    datasourceId: string,
    tableName: string,
    dto: BatchUpsertColumnMetadataDto,
  ): Promise<DatasourceMetadata[]> {
    const out: DatasourceMetadata[] = [];
    for (const col of dto.columns) {
      out.push(await this.upsertColumnMeta(datasourceId, tableName, col));
    }
    return out;
  }

  // ============= 业务术语词典 =============

  async listGlossary(datasourceId: string): Promise<DatasourceGlossary[]> {
    return this.glossaryRepo.find({
      where: { datasourceId },
      order: { term: 'ASC' },
    });
  }

  async createGlossary(datasourceId: string, dto: GlossaryDto): Promise<DatasourceGlossary> {
    return this.glossaryRepo.save(
      this.glossaryRepo.create({
        datasourceId,
        term: dto.term,
        meaning: dto.meaning,
        exampleSql: dto.exampleSql,
        appliesToTables: dto.appliesToTables || [],
      }),
    );
  }

  async updateGlossary(id: string, dto: GlossaryDto): Promise<DatasourceGlossary> {
    const row = await this.glossaryRepo.findOne({ where: { id } });
    if (!row) throw new NotFoundException(`Glossary ${id} not found`);
    Object.assign(row, dto);
    return this.glossaryRepo.save(row);
  }

  async deleteGlossary(id: string): Promise<void> {
    await this.glossaryRepo.delete(id);
  }

  // ============= 推荐问题 =============

  async listQuestions(datasourceId: string): Promise<SuggestedQuestion[]> {
    return this.questionRepo.find({
      where: { datasourceId },
      order: { priority: 'DESC', createdAt: 'DESC' },
    });
  }

  async createQuestion(
    datasourceId: string,
    dto: SuggestedQuestionDto,
    createdBy?: string,
  ): Promise<SuggestedQuestion> {
    return this.questionRepo.save(
      this.questionRepo.create({
        datasourceId,
        questionText: dto.questionText,
        priority: dto.priority ?? 0,
        learnedSql: dto.learnedSql,
        source: dto.learnedSql ? 'learned' : 'manual',
        createdBy,
      }),
    );
  }

  async deleteQuestion(id: string): Promise<void> {
    await this.questionRepo.delete(id);
  }
}
