import {
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, IsNull, In } from 'typeorm';
import { randomUUID } from 'crypto';
import {
  UserDataset,
  DatasetColumn,
  DatasetStatus,
  ProjectMember,
} from '../../../database/entities';
import { DatasetParserService } from './dataset-parser.service';
import { DatasetImportService } from './dataset-import.service';
import { ProjectService } from '../../project/services/project.service';

/**
 * Dataset 业务编排：
 *   1) uploadAndParse() — 同步解析（< 5s），返回 dataset.id + preview
 *   2) confirmAndImport() — 用户确认 schema 后入队（in-process async）入库
 *   3) list / get / delete / updateAssignment
 */
@Injectable()
export class DatasetService {
  private readonly logger = new Logger(DatasetService.name);

  constructor(
    @InjectRepository(UserDataset)
    private readonly datasetRepo: Repository<UserDataset>,
    @InjectRepository(ProjectMember)
    private readonly memberRepo: Repository<ProjectMember>,
    private readonly parser: DatasetParserService,
    private readonly importer: DatasetImportService,
    private readonly projectService: ProjectService,
  ) {}

  // ========== Phase 1: upload + parse (同步) ==========

  async uploadAndParse(
    file: { buffer: Buffer; originalname: string; mimetype: string; size: number },
    userId: string,
  ): Promise<UserDataset> {
    if (file.size > 50 * 1024 * 1024) {
      throw new BadRequestException('文件超过 50MB 上限');
    }
    if (file.size === 0) {
      throw new BadRequestException('文件为空');
    }

    // 确保用户有 Personal Workspace（学 Claude Personal Project）
    // 每个 dataset 必须挂某个 project — 默认挂 personal workspace
    const personalWs = await this.projectService.ensurePersonalWorkspace(userId);

    // 立即建 dataset 记录，status=parsing
    const dataset = await this.datasetRepo.save(
      this.datasetRepo.create({
        ownerId: userId,
        projectId: personalWs.id,
        sourceFilename: file.originalname,
        sourceSizeBytes: file.size,
        sourceMime: file.mimetype,
        displayName: file.originalname.replace(/\.[^.]+$/, ''),
        status: 'parsing',
      }),
    );

    try {
      const parsed = await this.parser.parse(file.buffer, file.mimetype, file.originalname);
      dataset.columns = parsed.columns;
      dataset.rowCount = parsed.rowCount;
      dataset.status = 'awaiting_confirm';
      await this.datasetRepo.save(dataset);

      // 把 parser 结果暂存到内存（confirm 阶段要用）
      // MVP: 简单内存 Map；大文件 / 多节点应改为临时 PG 表或 Redis
      this.pendingParsed.set(dataset.id, parsed);
      // TTL 10 分钟自动清
      setTimeout(() => this.pendingParsed.delete(dataset.id), 10 * 60 * 1000);

      this.logger.log(
        `Parsed ${file.originalname}: ${parsed.rowCount} rows, ${parsed.columns.length} cols → dataset ${dataset.id}`,
      );
      return dataset;
    } catch (err) {
      dataset.status = 'failed';
      dataset.errorMessage = (err as Error).message;
      await this.datasetRepo.save(dataset);
      throw new BadRequestException(`解析失败: ${(err as Error).message}`);
    }
  }

  // ========== Phase 2: confirm schema + import (async) ==========

  /**
   * 用户在 schema 确认页提交：
   *   - 可改 displayName / description / projectId(共享归属)
   *   - 可改每列的 name / type / description / skipped
   * 提交后入队真实入库（in-process setImmediate）。
   */
  async confirmAndImport(
    datasetId: string,
    userId: string,
    dto: {
      displayName?: string;
      description?: string;
      projectId?: string | null;
      columns: DatasetColumn[];
    },
  ): Promise<UserDataset> {
    const dataset = await this.getOwnedDataset(datasetId, userId);
    if (dataset.status !== 'awaiting_confirm') {
      throw new BadRequestException(
        `Dataset 状态为 ${dataset.status}，无法 confirm`,
      );
    }
    const parsed = this.pendingParsed.get(datasetId);
    if (!parsed) {
      throw new BadRequestException(
        '解析数据已过期（10 分钟），请重新上传',
      );
    }

    // dataset 必须挂某个 project — 若用户没指定，默认 personal workspace
    // 用户指定的，校验其 project 访问权限
    let targetProjectId: string;
    if (dto.projectId) {
      const canAccess = await this.projectService.canAccess(dto.projectId, userId);
      if (!canAccess) {
        throw new ForbiddenException('你不是该项目成员，无法把数据集挂到它');
      }
      targetProjectId = dto.projectId;
    } else {
      // 兜底：personal workspace（理论上 uploadAndParse 已经挂过了，这里再保险一次）
      const ws = await this.projectService.ensurePersonalWorkspace(userId);
      targetProjectId = ws.id;
    }

    // 用用户编辑后的 columns 替代（保留 originalName / sample / nullRatio）
    const merged = dto.columns.map((edited) => {
      const original = parsed.columns.find(
        (p) => p.originalName === edited.originalName || p.name === edited.originalName,
      );
      return {
        ...edited,
        sample: original?.sample,
        nullRatio: original?.nullRatio,
      } as DatasetColumn;
    });

    // 更新 dataset
    dataset.displayName = dto.displayName?.trim() || dataset.displayName;
    dataset.description = dto.description?.trim() || null;
    dataset.projectId = targetProjectId;
    dataset.columns = merged;
    dataset.status = 'importing';
    dataset.tableName = `ds_${datasetId.replace(/-/g, '')}`;
    await this.datasetRepo.save(dataset);

    // 异步入库（不阻塞 API）
    setImmediate(() => {
      void this.runImport(dataset.id, merged, parsed.allRows || []).catch((err) => {
        this.logger.error(
          `Import failed for ${dataset.id}: ${(err as Error).message}`,
        );
      });
    });

    return dataset;
  }

  private async runImport(
    datasetId: string,
    columns: DatasetColumn[],
    rows: Record<string, any>[],
  ): Promise<void> {
    const dataset = await this.datasetRepo.findOne({ where: { id: datasetId } });
    if (!dataset || !dataset.tableName) return;
    try {
      const { rowCount } = await this.importer.createTableAndImport(
        dataset.tableName,
        columns,
        rows,
      );
      dataset.rowCount = rowCount;
      dataset.status = 'ready';
      dataset.errorMessage = null;
      await this.datasetRepo.save(dataset);
      this.pendingParsed.delete(datasetId);
      this.logger.log(`Dataset ${datasetId} imported successfully (${rowCount} rows)`);
    } catch (err) {
      dataset.status = 'failed';
      dataset.errorMessage = (err as Error).message;
      await this.datasetRepo.save(dataset);
      this.logger.error(`Import ${datasetId}: ${(err as Error).message}`);
    }
  }

  // ========== CRUD ==========

  /**
   * 列出当前用户可访问的所有 dataset。
   *
   * 新架构：dataset 必属于某 project（personal workspace 也是 project）；
   * 所以「能访问的 dataset」= 「该用户所有 project 下的 dataset」，一行查完。
   */
  async listAccessible(userId: string): Promise<UserDataset[]> {
    const accessibleProjects = await this.projectService.listForUser(userId);
    if (accessibleProjects.length === 0) {
      // 还没 personal workspace（首次用户）— 创一个保证后续 UI 正常
      await this.projectService.ensurePersonalWorkspace(userId);
      return [];
    }
    return this.datasetRepo.find({
      where: { projectId: In(accessibleProjects.map((p) => p.id)) },
      order: { createdAt: 'DESC' },
    });
  }

  async getAccessible(datasetId: string, userId: string): Promise<UserDataset> {
    const dataset = await this.datasetRepo.findOne({ where: { id: datasetId } });
    if (!dataset) throw new NotFoundException('Dataset not found');
    await this.assertCanAccess(dataset, userId);
    return dataset;
  }

  /** 删 dataset — 仅 owner */
  async delete(datasetId: string, userId: string): Promise<void> {
    const dataset = await this.getOwnedDataset(datasetId, userId);
    // 先 drop 物理表
    if (dataset.tableName) {
      try {
        await this.importer.dropTable(dataset.tableName);
      } catch (err) {
        this.logger.warn(`DROP TABLE failed for ${dataset.tableName}: ${(err as Error).message}`);
      }
    }
    await this.datasetRepo.delete(datasetId);
    this.pendingParsed.delete(datasetId);
  }

  /** 改归属（转到另一个 project，或回到 personal workspace）— 仅 owner */
  async updateAssignment(
    datasetId: string,
    userId: string,
    dto: { projectId?: string | null; displayName?: string; description?: string },
  ): Promise<UserDataset> {
    const dataset = await this.getOwnedDataset(datasetId, userId);
    if (dto.projectId !== undefined) {
      // null = 转回个人工作区；非空 = 转到指定 project（需要权限）
      if (dto.projectId) {
        const canAccess = await this.projectService.canAccess(dto.projectId, userId);
        if (!canAccess) throw new ForbiddenException('你不是该项目成员');
        dataset.projectId = dto.projectId;
      } else {
        const ws = await this.projectService.ensurePersonalWorkspace(userId);
        dataset.projectId = ws.id;
      }
    }
    if (dto.displayName !== undefined) dataset.displayName = dto.displayName.trim();
    if (dto.description !== undefined) dataset.description = dto.description?.trim() || null;
    if ((dto as any).columns !== undefined) dataset.columns = (dto as any).columns;
    return this.datasetRepo.save(dataset);
  }

  // ========== 权限 helper ==========

  async assertCanAccess(dataset: UserDataset, userId: string): Promise<void> {
    if (dataset.ownerId === userId) return;
    if (dataset.projectId) {
      const canAccess = await this.projectService.canAccess(dataset.projectId, userId);
      if (canAccess) return;
    }
    throw new ForbiddenException('无权访问该数据集');
  }

  async getOwnedDataset(datasetId: string, userId: string): Promise<UserDataset> {
    const dataset = await this.datasetRepo.findOne({ where: { id: datasetId } });
    if (!dataset) throw new NotFoundException('Dataset not found');
    if (dataset.ownerId !== userId) {
      throw new ForbiddenException('仅 owner 可执行此操作');
    }
    return dataset;
  }

  // ========== 给 Chat 集成用：拿用户可访问的所有 dataset 表名 ==========

  /** 返回 user_data.<tableName> 全路径列表 — 用于 ToolContext.allowedTables 注入 */
  async getAccessibleTableNames(userId: string): Promise<string[]> {
    const all = await this.listAccessible(userId);
    return all
      .filter((d) => d.status === 'ready' && d.tableName)
      .map((d) => `user_data.${d.tableName}`);
  }

  // ========== private state ==========

  /** 解析结果暂存（confirm 阶段消费）— 10min TTL */
  private pendingParsed = new Map<string, { allRows?: Record<string, any>[]; columns: DatasetColumn[] }>();
}
