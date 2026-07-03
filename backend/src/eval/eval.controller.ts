import {
  Controller,
  ForbiddenException,
  Get,
  Param,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser, AuthUser } from '../modules/auth/decorators/current-user.decorator';
import { EvalHistoryService } from './eval-history.service';

/**
 * Admin-only endpoint 看历史 eval runs
 *
 * 用途：
 *   - Anatoli 的 "cost per accepted change" 时序追踪
 *   - 每次改 prompt / 加工具后跑一次 eval，dashboard 显示趋势
 */
@ApiTags('Admin · Eval History')
@ApiBearerAuth()
@Controller('admin/eval-runs')
export class EvalController {
  constructor(private readonly history: EvalHistoryService) {}

  @Get()
  @ApiOperation({ summary: '列出所有历史 eval run（仅 admin）' })
  async list(@CurrentUser() user: AuthUser) {
    this.assertAdmin(user);
    return this.history.list();
  }

  @Get(':runId')
  @ApiOperation({ summary: '单 run 完整报告（含每 task 详情 / verifier trace）' })
  async detail(@CurrentUser() user: AuthUser, @Param('runId') runId: string) {
    this.assertAdmin(user);
    return this.history.getOne(runId);
  }

  private assertAdmin(user: AuthUser): void {
    if (!user?.isAdmin) throw new ForbiddenException('仅管理员可访问');
  }
}
