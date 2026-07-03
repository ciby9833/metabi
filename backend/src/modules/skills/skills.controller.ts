import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { SkillLoaderService } from '../../providers/skills/skill-loader.service';
import {
  SkillEditorService,
  SkillUpdateDto,
  SkillUpsertDto,
} from '../../providers/skills/skill-editor.service';
import { Public } from '../auth/decorators/public.decorator';
import { CurrentUser, AuthUser } from '../auth/decorators/current-user.decorator';
import { ForbiddenException } from '@nestjs/common';
import { ProjectService } from '../project/services/project.service';
import { isSkillVisibleToUser } from '../../providers/skills/types';
import type { SkillEntity } from '../../database/entities';

@ApiTags('Skills')
@Controller('skills')
export class SkillsController {
  constructor(
    private readonly loader: SkillLoaderService,
    private readonly editor: SkillEditorService,
    private readonly projectService: ProjectService,
  ) {}

  /** 通用序列化（含 visibility 三元组） */
  private serialize(s: SkillEntity, withBody: boolean) {
    return {
      name: s.name,
      version: s.version,
      description: s.description,
      match: s.match,
      priority: s.priority,
      tables: s.tables,
      attributableDimensions: s.attributableDimensions,
      datasourceTypes: s.datasourceTypes,
      ...(withBody ? { body: s.body } : { bodyPreview: s.body.substring(0, 300) }),
      isActive: s.isActive,
      source: s.source,
      hasRollback: !!s.previousBody,
      rowVersion: s.rowVersion,
      visibility: s.visibility,
      projectId: s.projectId,
      ownerUserId: s.ownerUserId,
      createdAt: (s as any).createdAt,
      updatedAt: s.updatedAt,
      updatedBy: s.updatedBy,
    };
  }

  // ============== 读（按 user visibility 过滤） ==============

  @Get()
  @ApiOperation({ summary: '列出当前用户可见的 Skill' })
  async list(
    @CurrentUser() user: AuthUser | null,
    @Query('include_inactive') includeInactive?: string,
  ) {
    const all = await this.editor.listAll();
    const active = includeInactive === 'true' ? all : all.filter((s) => s.isActive);
    // 按可见性过滤：未登录仅 global；登录用户按 personal / project membership
    const userCtx = user
      ? {
          userId: user.id,
          accessibleProjectIds: (await this.projectService.listForUser(user.id)).map((p) => p.id),
        }
      : undefined;
    const visible = active.filter((s) => isSkillVisibleToUser(s as any, userCtx));
    return visible.map((s) => this.serialize(s, false));
  }

  @Get(':name')
  @ApiOperation({ summary: '获取单个 Skill 完整内容' })
  async getOne(@CurrentUser() user: AuthUser | null, @Param('name') name: string) {
    const s = await this.editor.getByName(name);
    const userCtx = user
      ? {
          userId: user.id,
          accessibleProjectIds: (await this.projectService.listForUser(user.id)).map((p) => p.id),
        }
      : undefined;
    if (!isSkillVisibleToUser(s as any, userCtx)) {
      throw new ForbiddenException('无权访问该 Skill');
    }
    return this.serialize(s, true);
  }

  // ============== 写（要登录 + 记录 updatedBy） ==============

  @ApiBearerAuth()
  @Post()
  @ApiOperation({ summary: '新建 Skill' })
  async create(@CurrentUser() user: AuthUser, @Body() dto: SkillUpsertDto) {
    return this.editor.create(dto, user.id);
  }

  @ApiBearerAuth()
  @Patch(':name')
  @ApiOperation({ summary: '更新 Skill（需带 rowVersion 做乐观锁）' })
  async update(
    @CurrentUser() user: AuthUser,
    @Param('name') name: string,
    @Body() dto: SkillUpdateDto,
  ) {
    return this.editor.update(name, dto, user.id);
  }

  @ApiBearerAuth()
  @Post(':name/rollback')
  @ApiOperation({ summary: '回滚到上一个 body（可重复点用于来回切换）' })
  async rollback(@CurrentUser() user: AuthUser, @Param('name') name: string) {
    return this.editor.rollback(name, user.id);
  }

  @ApiBearerAuth()
  @Post(':name/deactivate')
  @HttpCode(204)
  @ApiOperation({ summary: '停用（软删，Router 不会再路由到它）' })
  async deactivate(@Param('name') name: string) {
    await this.editor.deactivate(name);
  }

  @ApiBearerAuth()
  @Delete(':name')
  @HttpCode(204)
  @ApiOperation({ summary: '硬删除（不可恢复）' })
  async hardDelete(@Param('name') name: string) {
    await this.editor.hardDelete(name);
  }

  @ApiBearerAuth()
  @Post('reload')
  @ApiOperation({ summary: '强制从 DB 重新加载到内存（多 pod 同步时手动触发）' })
  async reload() {
    return this.editor.forceReload();
  }
}
