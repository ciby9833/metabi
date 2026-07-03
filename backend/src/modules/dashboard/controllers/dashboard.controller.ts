import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser, AuthUser } from '../../auth/decorators/current-user.decorator';
import { DashboardService } from '../services/dashboard.service';
import { WidgetService } from '../services/widget.service';
import { DashboardInterpretService } from '../services/dashboard-interpret.service';
import type { Dashboard } from '../../../database/entities';

@ApiTags('Dashboards')
@ApiBearerAuth()
@Controller('dashboards')
export class DashboardController {
  constructor(
    private readonly dashboardService: DashboardService,
    private readonly widgetService: WidgetService,
    private readonly interpretService: DashboardInterpretService,
  ) {}

  // ============ Dashboard CRUD ============

  @Get()
  @ApiOperation({ summary: '列出我可访问的所有看板' })
  list(@CurrentUser() user: AuthUser) {
    return this.dashboardService.listForUser(user.id);
  }

  @Get(':id')
  @ApiOperation({ summary: '看板详情（不含 widgets — 单独调 /widgets）' })
  getOne(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.dashboardService.getAccessible(id, user.id);
  }

  @Post()
  @ApiOperation({ summary: '新建看板' })
  create(
    @CurrentUser() user: AuthUser,
    @Body()
    body: {
      name: string;
      description?: string;
      icon?: string;
      projectId?: string | null;
    },
  ) {
    return this.dashboardService.create(body, user.id);
  }

  @Patch(':id')
  @ApiOperation({ summary: '更新看板' })
  update(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body()
    body: {
      name?: string;
      description?: string;
      icon?: string;
      projectId?: string | null;
      layout?: Dashboard['layout'];
    },
  ) {
    return this.dashboardService.update(id, body, user.id);
  }

  @Post(':id/interpret')
  @ApiOperation({ summary: '🧠 AI 综合解读整个看板（跨图洞见）' })
  interpret(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() body: { paramValues?: Record<string, any> } = {},
  ) {
    return this.interpretService.interpret(id, user.id, body.paramValues);
  }

  @Delete(':id')
  @HttpCode(204)
  @ApiOperation({ summary: '删除看板（含所有 widgets）' })
  async remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    await this.dashboardService.remove(id, user.id);
  }

  // ============ Widgets ============

  @Get(':id/widgets')
  @ApiOperation({ summary: '看板下所有 widgets' })
  listWidgets(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.widgetService.listForDashboard(id, user.id);
  }
}
