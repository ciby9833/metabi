import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { OptimisticLockVersionMismatchError, Repository } from 'typeorm';
import { SkillEntity } from '../../database/entities';
import { SkillLoaderService } from './skill-loader.service';

export interface SkillUpsertDto {
  name: string;
  version?: string;
  description: string;
  match?: string;
  priority?: number;
  tables?: string[];
  attributableDimensions?: string[];
  datasourceTypes?: string[];
  body: string;
  isActive?: boolean;
  /** 可见性 — 默认 'global'（全局可见）*/
  visibility?: 'global' | 'project' | 'personal';
  /** visibility='project' 时必填 */
  projectId?: string | null;
  /** visibility='personal' 时自动用 caller 的 userId */
  ownerUserId?: string | null;
}

export interface SkillUpdateDto extends Partial<SkillUpsertDto> {
  /** 必传，乐观锁版本号 */
  rowVersion: number;
}

/**
 * Skill 编辑服务
 *
 * - 保存即生效（自动 reload SkillLoaderService 内存缓存）
 * - 乐观锁：前端必须带上 rowVersion，DB 不匹配则 409
 * - 删除 = 软删除（设 isActive=false），保留数据可恢复
 * - 一键回滚：把 previous_body 设为 body
 */
@Injectable()
export class SkillEditorService {
  private readonly logger = new Logger(SkillEditorService.name);

  constructor(
    @InjectRepository(SkillEntity)
    private readonly repo: Repository<SkillEntity>,
    private readonly loader: SkillLoaderService,
  ) {}

  async listAll(): Promise<SkillEntity[]> {
    return this.repo.find({ order: { priority: 'DESC', name: 'ASC' } });
  }

  async getByName(name: string): Promise<SkillEntity> {
    const row = await this.repo.findOne({ where: { name } });
    if (!row) throw new NotFoundException(`Skill ${name} not found`);
    return row;
  }

  async create(dto: SkillUpsertDto, userId?: string): Promise<SkillEntity> {
    this.validate(dto);
    const existed = await this.repo.findOne({ where: { name: dto.name } });
    if (existed) throw new ConflictException(`Skill name '${dto.name}' already exists`);
    const { visibility, projectId, ownerUserId } = this.resolveVisibility(dto, userId);
    const row = this.repo.create({
      name: dto.name,
      version: dto.version || '1.0.0',
      description: dto.description,
      match: dto.match || null,
      priority: dto.priority ?? 0,
      tables: dto.tables || null,
      attributableDimensions: dto.attributableDimensions || null,
      datasourceTypes: dto.datasourceTypes || null,
      body: dto.body,
      isActive: dto.isActive !== false,
      source: 'user',
      updatedBy: userId || null,
      previousBody: null,
      visibility,
      projectId,
      ownerUserId,
    });
    const saved = await this.repo.save(row);
    await this.loader.reload();
    return saved;
  }

  /**
   * 校验并归一化 visibility 三元组（visibility / projectId / ownerUserId）。
   * - global:   projectId=null, ownerUserId=null
   * - project:  projectId 必填，ownerUserId=null
   * - personal: ownerUserId 自动用 caller userId（DTO 不接受外部传入，安全）
   */
  private resolveVisibility(
    dto: { visibility?: 'global' | 'project' | 'personal'; projectId?: string | null },
    userId?: string,
  ): { visibility: 'global' | 'project' | 'personal'; projectId: string | null; ownerUserId: string | null } {
    const v = dto.visibility ?? 'global';
    if (v === 'project') {
      if (!dto.projectId) {
        throw new ConflictException('visibility=project 必须提供 projectId');
      }
      return { visibility: 'project', projectId: dto.projectId, ownerUserId: null };
    }
    if (v === 'personal') {
      if (!userId) {
        throw new ConflictException('visibility=personal 需登录态');
      }
      return { visibility: 'personal', projectId: null, ownerUserId: userId };
    }
    return { visibility: 'global', projectId: null, ownerUserId: null };
  }

  async update(name: string, dto: SkillUpdateDto, userId?: string): Promise<SkillEntity> {
    const existing = await this.getByName(name);
    if (dto.rowVersion !== existing.rowVersion) {
      throw new ConflictException(
        `Skill 已被其他人修改（当前版本 ${existing.rowVersion}，你提交的版本 ${dto.rowVersion}）。请刷新后重试。`,
      );
    }
    // 保留前一版用于回滚
    if (dto.body !== undefined && dto.body !== existing.body) {
      existing.previousBody = existing.body;
    }
    if (dto.version !== undefined) existing.version = dto.version;
    if (dto.description !== undefined) existing.description = dto.description;
    if (dto.match !== undefined) existing.match = dto.match || null;
    if (dto.priority !== undefined) existing.priority = dto.priority;
    if (dto.tables !== undefined) existing.tables = dto.tables.length ? dto.tables : null;
    if (dto.attributableDimensions !== undefined)
      existing.attributableDimensions = dto.attributableDimensions.length
        ? dto.attributableDimensions
        : null;
    if (dto.datasourceTypes !== undefined)
      existing.datasourceTypes = dto.datasourceTypes.length ? dto.datasourceTypes : null;
    if (dto.body !== undefined) existing.body = dto.body;
    if (dto.isActive !== undefined) existing.isActive = dto.isActive;
    // visibility 切换：仅 owner / admin 应能改（API 层权限校验在 controller）
    if (dto.visibility !== undefined) {
      const resolved = this.resolveVisibility(
        { visibility: dto.visibility, projectId: dto.projectId ?? existing.projectId },
        userId,
      );
      existing.visibility = resolved.visibility;
      existing.projectId = resolved.projectId;
      existing.ownerUserId = resolved.ownerUserId;
    }
    existing.updatedBy = userId || existing.updatedBy;
    existing.source = 'user';

    this.validate(existing);
    try {
      const saved = await this.repo.save(existing);
      await this.loader.reload();
      return saved;
    } catch (err) {
      if (err instanceof OptimisticLockVersionMismatchError) {
        throw new ConflictException('并发编辑冲突，请刷新后重试');
      }
      throw err;
    }
  }

  /** 一键回滚到上一版 body */
  async rollback(name: string, userId?: string): Promise<SkillEntity> {
    const existing = await this.getByName(name);
    if (!existing.previousBody) {
      throw new ConflictException('没有可回滚的历史版本');
    }
    const currentBody = existing.body;
    existing.body = existing.previousBody;
    existing.previousBody = currentBody; // 互换，支持来回 toggle
    existing.updatedBy = userId || existing.updatedBy;
    const saved = await this.repo.save(existing);
    await this.loader.reload();
    return saved;
  }

  /** 软删除 = 停用 */
  async deactivate(name: string): Promise<void> {
    const existing = await this.getByName(name);
    existing.isActive = false;
    await this.repo.save(existing);
    await this.loader.reload();
  }

  /** 硬删除（不可逆） */
  async hardDelete(name: string): Promise<void> {
    await this.repo.delete({ name });
    await this.loader.reload();
  }

  async forceReload(): Promise<{ count: number }> {
    await this.loader.reload();
    return { count: this.loader.getAll().length };
  }

  private validate(dto: Partial<SkillEntity>): void {
    if (!dto.name || !/^[a-z0-9][\w-]*$/.test(dto.name)) {
      throw new ConflictException('Skill name 必须是 kebab-case，只允许字母数字-_');
    }
    if (!dto.description) throw new ConflictException('description 不能为空');
    if (!dto.body || dto.body.trim().length < 20) {
      throw new ConflictException('body 太短，至少 20 字');
    }
  }
}
