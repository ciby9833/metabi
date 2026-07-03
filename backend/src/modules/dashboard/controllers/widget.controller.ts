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
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser, AuthUser } from '../../auth/decorators/current-user.decorator';
import { WidgetService } from '../services/widget.service';
import { SuggestParamsService } from '../services/suggest-params.service';
import { DashboardInterpretService } from '../services/dashboard-interpret.service';
import { ExporterService } from '../../exports/services/exporter.service';
import { Widget } from '../../../database/entities';

@ApiTags('Widgets')
@ApiBearerAuth()
@Controller('widgets')
export class WidgetController {
  constructor(
    private readonly widgetService: WidgetService,
    private readonly suggestParamsService: SuggestParamsService,
    private readonly interpretService: DashboardInterpretService,
    private readonly exporter: ExporterService,
  ) {}

  @Post(':id/interpret')
  @ApiOperation({ summary: '🧠 单 widget 深度解读（纵向深挖）' })
  interpret(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.interpretService.interpretWidget(id, user.id);
  }

  @Get(':id/export')
  @ApiOperation({
    summary: '下载 widget 数据（Excel / CSV）；mode=display 是图表数据，mode=detail 是底表明细。流式响应，避免大结果 OOM',
  })
  async exportWidget(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Query('format') format: 'xlsx' | 'csv' = 'xlsx',
    @Query('mode') mode: 'display' | 'detail' = 'display',
    @Res() res: Response,
  ) {
    const fmt = format === 'csv' ? 'csv' : 'xlsx';
    const useMode = mode === 'detail' ? 'detail' : 'display';
    const prep = await this.widgetService.prepareExport(id, user.id, useMode);

    const mimeType =
      fmt === 'csv'
        ? 'text/csv; charset=utf-8'
        : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    const filename = prep.filename(fmt === 'csv' ? '.csv' : '.xlsx');
    const asciiFallback = filename.replace(/[^\x20-\x7E]/g, '_');
    const encoded = encodeURIComponent(filename);

    res.setHeader('Content-Type', mimeType);
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${asciiFallback}"; filename*=UTF-8''${encoded}`,
    );

    // 流式写响应 — 避免 buffer 整个 xlsx 到内存（10 万行也不 OOM）
    if (fmt === 'csv') {
      this.exporter.toCsvStream(
        { columns: prep.columns, rows: prep.rows, sheetName: filename },
        res,
      );
      res.end();
    } else {
      await this.exporter.toExcelStream(
        { columns: prep.columns, rows: prep.rows, sheetName: 'Sheet1' },
        res,
      );
      // WorkbookWriter.commit() 会自动 end 底层 stream，这里 no-op
    }
  }

  @Post('suggest-params')
  @ApiOperation({ summary: '🤖 让 AI 分析 SQL 并建议可参数化项（不改数据库）' })
  async suggestParams(
    @CurrentUser() _user: AuthUser,
    @Body() body: { sql: string; existingParams?: Widget['params'] },
  ) {
    return this.suggestParamsService.suggest(body.sql, body.existingParams ?? null);
  }

  @Post('save-from-turn')
  @ApiOperation({ summary: '从 chat turn 一键固化到 widget（可选建新看板）' })
  saveFromTurn(
    @CurrentUser() user: AuthUser,
    @Body()
    body: {
      messageId: string;
      dashboardId?: string;
      newDashboardName?: string;
      newDashboardProjectId?: string | null;
      widgetTitle: string;
      widgetDescription?: string;
      chartType?: 'bar' | 'line' | 'pie' | 'table' | 'kpi';
      params?: Widget['params'];
    },
  ) {
    return this.widgetService.saveFromTurn(body, user.id);
  }

  @Post()
  @ApiOperation({ summary: '新建 widget' })
  create(
    @CurrentUser() user: AuthUser,
    @Body()
    body: {
      dashboardId: string;
      title: string;
      description?: string;
      datasourceId?: string | null;
      datasetIds?: string[] | null;
      projectId?: string | null;
      sql: string;
      params?: Widget['params'];
      chartConfig: Widget['chartConfig'];
      width?: 'full' | 'half' | 'third';
      height?: 'small' | 'medium' | 'large';
    },
  ) {
    return this.widgetService.create(body, user.id);
  }

  @Patch(':id')
  @ApiOperation({ summary: '更新 widget' })
  update(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body()
    body: {
      title?: string;
      description?: string;
      chartConfig?: Widget['chartConfig'];
      sql?: string;
      params?: Widget['params'];
      width?: 'full' | 'half' | 'third';
      height?: 'small' | 'medium' | 'large';
      position?: number;
    },
  ) {
    return this.widgetService.update(id, body, user.id);
  }

  @Post(':id/refresh')
  @ApiOperation({ summary: '重跑 SQL 刷新数据 — body 可带 paramValues 覆盖 default' })
  refresh(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() body: { paramValues?: Record<string, any> } = {},
  ) {
    return this.widgetService.refresh(id, user.id, body.paramValues);
  }

  @Delete(':id')
  @HttpCode(204)
  @ApiOperation({ summary: '删除 widget' })
  async remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    await this.widgetService.remove(id, user.id);
  }
}
