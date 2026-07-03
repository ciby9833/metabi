import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { Project, ProjectMember, ProjectRole, User } from '../../../database/entities';

export interface CreateProjectDto {
  name: string;
  description?: string;
  icon?: string;
  systemInstructions?: string;
}

export interface UpdateProjectDto {
  name?: string;
  description?: string;
  icon?: string;
  systemInstructions?: string;
  isActive?: boolean;
}

export interface InviteMemberDto {
  /** 对方的 email；未注册则报错（注册后再邀） */
  email: string;
  role: Exclude<ProjectRole, 'owner'>;
}

const PERMISSION_HIERARCHY: Record<ProjectRole, number> = {
  viewer: 1,
  editor: 2,
  admin: 3,
  owner: 4,
};

@Injectable()
export class ProjectService {
  private readonly logger = new Logger(ProjectService.name);

  constructor(
    @InjectRepository(Project)
    private readonly projectRepo: Repository<Project>,
    @InjectRepository(ProjectMember)
    private readonly memberRepo: Repository<ProjectMember>,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
  ) {}

  // ============== 查询 ==============

  /** 列出用户参与的全部 project（owner + 成员）+ 成员数 + 角色 */
  async listForUser(userId: string) {
    // 1) 拿用户作为 member 的 project ids
    const memberRows = await this.memberRepo.find({ where: { userId } });
    const memberMap = new Map(memberRows.map((m) => [m.projectId, m.role]));

    // 2) 拿用户作为 owner 的 + 作为 member 的
    const rows = await this.projectRepo
      .createQueryBuilder('p')
      .where('p.owner_id = :uid', { uid: userId })
      .orWhere('p.id IN (:...ids)', { ids: memberRows.length ? memberRows.map((m) => m.projectId) : ['00000000-0000-0000-0000-000000000000'] })
      .orderBy('p.updated_at', 'DESC')
      .getMany();

    // 3) 批量算 memberCount
    const counts = await this.memberRepo
      .createQueryBuilder('m')
      .select('m.project_id', 'projectId')
      .addSelect('COUNT(*)', 'count')
      .where('m.project_id IN (:...ids)', { ids: rows.length ? rows.map((p) => p.id) : ['00000000-0000-0000-0000-000000000000'] })
      .groupBy('m.project_id')
      .getRawMany();
    const countMap = new Map(counts.map((c) => [c.projectId, parseInt(c.count, 10)]));

    return rows.map((p) => ({
      ...p,
      myRole: (p.ownerId === userId ? 'owner' : memberMap.get(p.id) || 'viewer') as ProjectRole,
      memberCount: (countMap.get(p.id) || 0) + 1, // 含 owner
    }));
  }

  async getOne(projectId: string, userId: string) {
    const project = await this.projectRepo.findOne({ where: { id: projectId } });
    if (!project) throw new NotFoundException('Project 不存在');
    const role = await this.getRole(projectId, userId);
    if (!role) throw new ForbiddenException('无权访问该 Project');
    return {
      ...project,
      myRole: role,
    };
  }

  /** 内部用：用户在此 project 的角色（null 表示无权限） */
  async getRole(projectId: string, userId: string): Promise<ProjectRole | null> {
    const project = await this.projectRepo.findOne({ where: { id: projectId } });
    if (!project) return null;
    if (project.ownerId === userId) return 'owner';
    const member = await this.memberRepo.findOne({ where: { projectId, userId } });
    return member?.role || null;
  }

  /** 用于 ChatService 校验：用户能不能在此 project 下读 / 写对话 */
  async canAccess(projectId: string, userId: string): Promise<boolean> {
    return !!(await this.getRole(projectId, userId));
  }

  async canEdit(projectId: string, userId: string): Promise<boolean> {
    const role = await this.getRole(projectId, userId);
    if (!role) return false;
    return PERMISSION_HIERARCHY[role] >= PERMISSION_HIERARCHY.editor;
  }

  // ============== 写 ==============

  async create(dto: CreateProjectDto, ownerId: string) {
    if (!dto.name?.trim()) throw new BadRequestException('项目名不能为空');
    const project = await this.projectRepo.save(
      this.projectRepo.create({
        name: dto.name.trim(),
        description: dto.description?.trim() || null,
        icon: dto.icon?.trim() || null,
        systemInstructions: dto.systemInstructions?.trim() || null,
        ownerId,
        isActive: true,
      }),
    );
    this.logger.log(`Project created: ${project.id} by ${ownerId}`);
    return project;
  }

  /**
   * 确保用户有一个 Personal Workspace project（学 Claude 的 Personal Project 概念）。
   * - 第一次调用：自动创建一个 is_personal_workspace=true 的 project
   * - 后续调用：返回已存在的
   *
   * 用途：
   *   - 用户上传 dataset 默认挂这里
   *   - Chat 自助分析的默认归属
   *   - UI 显示为「我的工作区」
   *
   * 注意：DB 有 partial unique index 保证一个 owner 最多一个 personal workspace。
   */
  async ensurePersonalWorkspace(userId: string) {
    const existing = await this.projectRepo.findOne({
      where: { ownerId: userId, isPersonalWorkspace: true },
    });
    if (existing) return existing;

    try {
      const created = await this.projectRepo.save(
        this.projectRepo.create({
          name: '我的工作区',
          description: '默认的个人工作空间 — 上传的私有数据集和分析会话默认归这里',
          icon: '🏠',
          systemInstructions: null,
          ownerId: userId,
          isActive: true,
          isPersonalWorkspace: true,
        }),
      );
      this.logger.log(`Personal workspace created: ${created.id} for ${userId}`);
      return created;
    } catch (err) {
      // 并发场景：另一个请求已经创建了 — 退回去查一次
      const fallback = await this.projectRepo.findOne({
        where: { ownerId: userId, isPersonalWorkspace: true },
      });
      if (fallback) return fallback;
      throw err;
    }
  }

  async update(projectId: string, dto: UpdateProjectDto, userId: string) {
    const role = await this.getRole(projectId, userId);
    if (!role || PERMISSION_HIERARCHY[role] < PERMISSION_HIERARCHY.admin) {
      throw new ForbiddenException('需要 admin 或 owner 权限');
    }
    const project = await this.projectRepo.findOne({ where: { id: projectId } });
    if (!project) throw new NotFoundException('Project 不存在');
    if (dto.name !== undefined) project.name = dto.name.trim();
    if (dto.description !== undefined) project.description = dto.description?.trim() || null;
    if (dto.icon !== undefined) project.icon = dto.icon?.trim() || null;
    if (dto.systemInstructions !== undefined) {
      project.systemInstructions = dto.systemInstructions?.trim() || null;
    }
    if (dto.isActive !== undefined) project.isActive = dto.isActive;
    return this.projectRepo.save(project);
  }

  async remove(projectId: string, userId: string) {
    const role = await this.getRole(projectId, userId);
    if (role !== 'owner') throw new ForbiddenException('只有 owner 能删除 Project');
    await this.projectRepo.delete({ id: projectId });
  }

  // ============== 成员管理 ==============

  async listMembers(projectId: string, userId: string) {
    const myRole = await this.getRole(projectId, userId);
    if (!myRole) throw new ForbiddenException('无权访问该 Project');
    const project = await this.projectRepo.findOne({ where: { id: projectId } });
    if (!project) throw new NotFoundException();

    const members = await this.memberRepo
      .createQueryBuilder('m')
      .leftJoinAndMapOne('m.user', User, 'u', 'u.id = m.user_id')
      .where('m.project_id = :pid', { pid: projectId })
      .orderBy('m.created_at', 'ASC')
      .getMany();

    // owner 拼到最前
    const owner = await this.userRepo.findOne({ where: { id: project.ownerId } });
    const ownerRow = owner
      ? {
          id: 'owner',
          projectId,
          userId: owner.id,
          role: 'owner' as ProjectRole,
          user: { id: owner.id, name: owner.name, email: owner.email, avatarUrl: owner.avatarUrl },
          createdAt: project.createdAt,
        }
      : null;

    const rest = members.map((m) => ({
      id: m.id,
      projectId: m.projectId,
      userId: m.userId,
      role: m.role,
      user: m.user
        ? {
            id: (m.user as any).id,
            name: (m.user as any).name,
            email: (m.user as any).email,
            avatarUrl: (m.user as any).avatarUrl,
          }
        : null,
      createdAt: m.createdAt,
    }));

    return ownerRow ? [ownerRow, ...rest] : rest;
  }

  async invite(projectId: string, dto: InviteMemberDto, inviterId: string) {
    const myRole = await this.getRole(projectId, inviterId);
    if (!myRole || PERMISSION_HIERARCHY[myRole] < PERMISSION_HIERARCHY.admin) {
      throw new ForbiddenException('需要 admin 或 owner 权限');
    }
    const email = dto.email.trim().toLowerCase();
    const user = await this.userRepo.findOne({ where: { email } });
    if (!user) throw new BadRequestException(`用户 ${email} 不存在，请先让对方注册`);

    const project = await this.projectRepo.findOne({ where: { id: projectId } });
    if (!project) throw new NotFoundException();
    if (project.ownerId === user.id) {
      throw new BadRequestException('该用户已经是 owner，无需邀请');
    }
    const existed = await this.memberRepo.findOne({ where: { projectId, userId: user.id } });
    if (existed) {
      existed.role = dto.role;
      return this.memberRepo.save(existed);
    }
    return this.memberRepo.save(
      this.memberRepo.create({
        projectId,
        userId: user.id,
        role: dto.role,
        invitedBy: inviterId,
      }),
    );
  }

  async updateMemberRole(
    projectId: string,
    memberId: string,
    newRole: Exclude<ProjectRole, 'owner'>,
    operatorId: string,
  ) {
    const myRole = await this.getRole(projectId, operatorId);
    if (!myRole || PERMISSION_HIERARCHY[myRole] < PERMISSION_HIERARCHY.admin) {
      throw new ForbiddenException('需要 admin 或 owner 权限');
    }
    const member = await this.memberRepo.findOne({ where: { id: memberId, projectId } });
    if (!member) throw new NotFoundException('成员不存在');
    member.role = newRole;
    return this.memberRepo.save(member);
  }

  async removeMember(projectId: string, memberId: string, operatorId: string) {
    const myRole = await this.getRole(projectId, operatorId);
    if (!myRole || PERMISSION_HIERARCHY[myRole] < PERMISSION_HIERARCHY.admin) {
      throw new ForbiddenException('需要 admin 或 owner 权限');
    }
    const member = await this.memberRepo.findOne({ where: { id: memberId, projectId } });
    if (!member) throw new NotFoundException('成员不存在');
    await this.memberRepo.delete({ id: memberId });
  }

  /** 用户主动退出（owner 不能退） */
  async leave(projectId: string, userId: string) {
    const project = await this.projectRepo.findOne({ where: { id: projectId } });
    if (!project) throw new NotFoundException();
    if (project.ownerId === userId) {
      throw new BadRequestException('owner 不能退出。请先转让 owner 或删除项目');
    }
    await this.memberRepo.delete({ projectId, userId });
  }
}
