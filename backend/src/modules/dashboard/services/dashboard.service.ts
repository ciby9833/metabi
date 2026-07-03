import { ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { Dashboard, Widget } from '../../../database/entities';
import { ProjectService } from '../../project/services/project.service';

interface CreateDashboardDto {
  name: string;
  description?: string;
  icon?: string;
  projectId?: string | null;
}

interface UpdateDashboardDto {
  name?: string;
  description?: string | null;
  icon?: string | null;
  projectId?: string | null;
  layout?: Dashboard['layout'];
}

/**
 * DashboardService — 看板 CRUD + 权限
 *
 * 权限：
 *   - 个人看板（projectId=null）：仅 ownerId 可访问
 *   - 项目看板（projectId≠null）：project member 都可访问（读）；owner/editor+ 可写
 */
@Injectable()
export class DashboardService {
  private readonly logger = new Logger(DashboardService.name);

  constructor(
    @InjectRepository(Dashboard)
    private readonly dashboardRepo: Repository<Dashboard>,
    @InjectRepository(Widget)
    private readonly widgetRepo: Repository<Widget>,
    private readonly projectService: ProjectService,
  ) {}

  /** 列出用户可访问的看板 */
  async listForUser(userId: string): Promise<Dashboard[]> {
    const projects = await this.projectService.listForUser(userId);
    const projectIds = projects.map((p) => p.id);

    // 个人 + 参与项目的看板
    const where: any[] = [{ ownerId: userId, projectId: null }];
    if (projectIds.length > 0) where.push({ projectId: In(projectIds) });

    return this.dashboardRepo.find({
      where,
      order: { updatedAt: 'DESC' },
    });
  }

  async getAccessible(id: string, userId: string): Promise<Dashboard> {
    const d = await this.dashboardRepo.findOne({ where: { id } });
    if (!d) throw new NotFoundException('Dashboard 不存在');
    await this.assertCanAccess(d, userId);
    return d;
  }

  async create(dto: CreateDashboardDto, userId: string): Promise<Dashboard> {
    if (!dto.name?.trim()) throw new NotFoundException('看板名必填');
    // 若指定 project 则校验可访问
    if (dto.projectId) {
      const canAccess = await this.projectService.canAccess(dto.projectId, userId);
      if (!canAccess) throw new ForbiddenException('无权在此项目创建看板');
    }
    const saved = await this.dashboardRepo.save(
      this.dashboardRepo.create({
        ownerId: userId,
        projectId: dto.projectId || null,
        name: dto.name.trim(),
        description: dto.description?.trim() || null,
        icon: dto.icon?.trim() || '📊',
      }),
    );
    this.logger.log(`Dashboard created: ${saved.id} by ${userId}`);
    return saved;
  }

  async update(id: string, dto: UpdateDashboardDto, userId: string): Promise<Dashboard> {
    const d = await this.getAccessible(id, userId);
    await this.assertCanWrite(d, userId);
    if (dto.name !== undefined) d.name = dto.name.trim();
    if (dto.description !== undefined) d.description = dto.description?.trim() || null;
    if (dto.icon !== undefined) d.icon = dto.icon?.trim() || null;
    if (dto.projectId !== undefined) {
      if (dto.projectId) {
        const canAccess = await this.projectService.canAccess(dto.projectId, userId);
        if (!canAccess) throw new ForbiddenException('无权转移到该项目');
      }
      d.projectId = dto.projectId || null;
    }
    if (dto.layout !== undefined) d.layout = dto.layout;
    d.updatedAt = new Date();
    return this.dashboardRepo.save(d);
  }

  async remove(id: string, userId: string): Promise<void> {
    const d = await this.getAccessible(id, userId);
    // 仅 owner 可删（避免 project member 误删）
    if (d.ownerId !== userId) {
      throw new ForbiddenException('仅创建者可删除看板');
    }
    // 级联删除 widgets（DB 没设 CASCADE，手动清）
    await this.widgetRepo.delete({ dashboardId: id });
    await this.dashboardRepo.delete({ id });
    this.logger.log(`Dashboard deleted: ${id} by ${userId}`);
  }

  // ============ 权限 ============

  async assertCanAccess(d: Dashboard, userId: string): Promise<void> {
    if (d.ownerId === userId) return;
    if (d.projectId) {
      const canAccess = await this.projectService.canAccess(d.projectId, userId);
      if (canAccess) return;
    }
    throw new ForbiddenException('无权访问该看板');
  }

  /** 写权限：个人 owner 或 project editor+ */
  async assertCanWrite(d: Dashboard, userId: string): Promise<void> {
    if (d.ownerId === userId) return;
    if (d.projectId) {
      const role = await this.projectService.getRole(d.projectId, userId);
      if (role && ['owner', 'admin', 'editor'].includes(role)) return;
    }
    throw new ForbiddenException('无权修改该看板');
  }
}
