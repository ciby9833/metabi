import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Patch,
  Post,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { UserProfileService } from '../services/profile.service';
import { ProfileRefinerService } from '../services/profile-refiner.service';
import { CurrentUser, AuthUser } from '../../auth/decorators/current-user.decorator';
import type { StyleMemory, ContentMemory } from '../../../database/entities';

@ApiTags('User Profile (Memory)')
@ApiBearerAuth()
@Controller('profile/preferences')
export class UserProfileController {
  constructor(
    private readonly service: UserProfileService,
    private readonly refiner: ProfileRefinerService,
  ) {}

  /** 当前用户的 profile（自动学习 + 用户编辑），透明展示 */
  @Get()
  @ApiOperation({ summary: '获取我的 Memory（含 style + content）' })
  async getMine(@CurrentUser() user: AuthUser) {
    const p = await this.service.getOrEmpty(user.id);
    return {
      styleMemory: p.styleMemory,
      contentMemory: p.contentMemory,
      lastRefinedAt: p.lastRefinedAt,
      refinedThroughConvCount: p.refinedThroughConvCount,
    };
  }

  /** 编辑 Style（用户主动选） */
  @Patch('style')
  @ApiOperation({ summary: '更新 Style 偏好（语气/详略/格式）' })
  async patchStyle(
    @CurrentUser() user: AuthUser,
    @Body() body: Partial<StyleMemory>,
  ) {
    const p = await this.service.patchStyle(user.id, body);
    return { styleMemory: p.styleMemory };
  }

  /** 编辑 Content（用户可修正 Refiner 学错的部分）*/
  @Patch('content')
  @ApiOperation({ summary: '更新 Content 偏好（关注领域/术语）' })
  async patchContent(
    @CurrentUser() user: AuthUser,
    @Body() body: Partial<ContentMemory>,
  ) {
    const p = await this.service.patchContent(user.id, body);
    return { contentMemory: p.contentMemory };
  }

  /** 一键 reset — anti-bias 关键设计 */
  @Delete()
  @ApiOperation({ summary: '清空我的 Memory（一键 reset）' })
  @HttpCode(200)
  async reset(@CurrentUser() user: AuthUser) {
    const p = await this.service.reset(user.id);
    return {
      styleMemory: p.styleMemory,
      contentMemory: p.contentMemory,
      lastRefinedAt: null,
    };
  }

  /** 手动触发 Refiner（"立刻分析我"按钮）*/
  @Post('refine')
  @ApiOperation({ summary: '立刻运行 Refiner（基于最近对话更新 Content）' })
  async refineNow(@CurrentUser() user: AuthUser) {
    await this.refiner.refineNow(user.id);
    const p = await this.service.getOrEmpty(user.id);
    return { contentMemory: p.contentMemory, lastRefinedAt: p.lastRefinedAt };
  }
}
