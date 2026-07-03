import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Conversation, Dashboard, TurnArtifact, Widget } from '../../../database/entities';
import { DashboardService } from './dashboard.service';
import { SqlTemplateService } from './sql-template.service';
import { SuggestDetailSqlService } from './suggest-detail-sql.service';
import { SqlExecutorService } from '../../../core/sql-engine/sql-executor.service';
import { DatasetService } from '../../dataset/services/dataset.service';
import { ExporterService } from '../../exports/services/exporter.service';

interface CreateWidgetDto {
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
}

interface UpdateWidgetDto {
  title?: string;
  description?: string;
  chartConfig?: Widget['chartConfig'];
  sql?: string;
  detailSql?: string | null;
  params?: Widget['params'];
  width?: 'full' | 'half' | 'third';
  height?: 'small' | 'medium' | 'large';
  position?: number;
}

@Injectable()
export class WidgetService {
  private readonly logger = new Logger(WidgetService.name);

  constructor(
    @InjectRepository(Widget)
    private readonly widgetRepo: Repository<Widget>,
    @InjectRepository(Dashboard)
    private readonly dashboardRepo: Repository<Dashboard>,
    @InjectRepository(TurnArtifact)
    private readonly turnArtifactRepo: Repository<TurnArtifact>,
    @InjectRepository(Conversation)
    private readonly conversationRepo: Repository<Conversation>,
    private readonly dashboardService: DashboardService,
    private readonly sqlExecutor: SqlExecutorService,
    private readonly datasetService: DatasetService,
    private readonly sqlTemplate: SqlTemplateService,
    private readonly exporter: ExporterService,
    private readonly suggestDetailSql: SuggestDetailSqlService,
  ) {}

  async listForDashboard(dashboardId: string, userId: string): Promise<Widget[]> {
    // 权限：通过 dashboard 校验
    await this.dashboardService.getAccessible(dashboardId, userId);
    return this.widgetRepo.find({
      where: { dashboardId },
      order: { position: 'ASC', createdAt: 'ASC' },
    });
  }

  async create(dto: CreateWidgetDto, userId: string): Promise<Widget> {
    if (!dto.title?.trim()) throw new BadRequestException('widget 标题必填');
    if (!dto.sql?.trim()) throw new BadRequestException('widget SQL 必填');
    if (!dto.datasourceId && (!dto.datasetIds || dto.datasetIds.length === 0)) {
      throw new BadRequestException('必须指定 datasourceId 或 datasetIds');
    }
    // 权限：能写 dashboard
    const dashboard = await this.dashboardService.getAccessible(dto.dashboardId, userId);
    await this.dashboardService.assertCanWrite(dashboard, userId);

    // 计算 position（新 widget 追加到末尾）
    const maxPos = await this.widgetRepo
      .createQueryBuilder('w')
      .where('w.dashboard_id = :id', { id: dto.dashboardId })
      .select('MAX(w.position)', 'maxPos')
      .getRawOne();
    const nextPosition = (maxPos?.maxPos ?? -1) + 1;

    const saved = await this.widgetRepo.save(
      this.widgetRepo.create({
        dashboardId: dto.dashboardId,
        title: dto.title.trim(),
        description: dto.description?.trim() || null,
        datasourceId: dto.datasourceId || null,
        datasetIds: dto.datasetIds || null,
        projectId: dto.projectId || null,
        sql: dto.sql,
        params: dto.params || null,
        chartConfig: dto.chartConfig,
        position: nextPosition,
        width: dto.width || 'half',
        height: dto.height || 'medium',
      }),
    );
    return saved;
  }

  async update(id: string, dto: UpdateWidgetDto, userId: string): Promise<Widget> {
    const w = await this.getAccessibleWidget(id, userId);
    const dashboard = await this.dashboardRepo.findOne({ where: { id: w.dashboardId } });
    if (dashboard) await this.dashboardService.assertCanWrite(dashboard, userId);
    if (dto.title !== undefined) w.title = dto.title.trim();
    if (dto.description !== undefined) w.description = dto.description?.trim() || null;
    if (dto.chartConfig !== undefined) w.chartConfig = dto.chartConfig;
    if (dto.sql !== undefined) w.sql = dto.sql;
    if (dto.detailSql !== undefined) w.detailSql = dto.detailSql;
    if (dto.params !== undefined) w.params = dto.params;
    if (dto.width !== undefined) w.width = dto.width;
    if (dto.height !== undefined) w.height = dto.height;
    if (dto.position !== undefined) w.position = dto.position;
    w.updatedAt = new Date();
    return this.widgetRepo.save(w);
  }

  async remove(id: string, userId: string): Promise<void> {
    const w = await this.getAccessibleWidget(id, userId);
    const dashboard = await this.dashboardRepo.findOne({ where: { id: w.dashboardId } });
    if (dashboard) await this.dashboardService.assertCanWrite(dashboard, userId);
    await this.widgetRepo.delete({ id });
  }

  /**
   * 从 chat turn 一键固化到 widget
   *
   * 输入 messageId → 找到对应 turnArtifact + conversation → 抽 SQL + result 快照
   * 用户可选：目标 dashboard（已有）或 新建（含 name）
   */
  async saveFromTurn(
    input: {
      messageId: string;
      dashboardId?: string;
      newDashboardName?: string;
      newDashboardProjectId?: string | null;
      widgetTitle: string;
      widgetDescription?: string;
      chartType?: 'bar' | 'line' | 'pie' | 'table' | 'kpi';
      params?: Widget['params'];
    },
    userId: string,
  ): Promise<{ dashboard: Dashboard; widget: Widget }> {
    // 1) 找 turnArtifact + conversation（校验用户是对话拥有者）
    const artifact = await this.turnArtifactRepo.findOne({
      where: { messageId: input.messageId },
    });
    if (!artifact || !artifact.finalSql) {
      throw new BadRequestException('该对话轮次没有可保存的 SQL 结果');
    }
    const conversation = await this.conversationRepo.findOne({
      where: { id: artifact.conversationId },
    });
    if (!conversation || conversation.userId !== userId) {
      throw new ForbiddenException('无权访问该对话');
    }

    // 2) 确定目标 dashboard（已有 or 新建）
    let dashboard: Dashboard;
    if (input.dashboardId) {
      dashboard = await this.dashboardService.getAccessible(input.dashboardId, userId);
      await this.dashboardService.assertCanWrite(dashboard, userId);
    } else {
      if (!input.newDashboardName?.trim()) {
        throw new BadRequestException('新建看板需填写名字');
      }
      dashboard = await this.dashboardService.create(
        {
          name: input.newDashboardName,
          projectId: input.newDashboardProjectId ?? null,
        },
        userId,
      );
    }

    // 3) 创建 widget，复用 conversation 的数据源 + result 快照
    const widget = await this.create(
      {
        dashboardId: dashboard.id,
        title: input.widgetTitle,
        description: input.widgetDescription,
        datasourceId: conversation.datasourceId || null,
        // dataset 模式：conversation 里没直接存 datasetIds — 后续 L2 扩
        datasetIds: null,
        projectId: conversation.projectId || null,
        sql: artifact.finalSql,
        params: input.params || null,
        chartConfig: {
          type: input.chartType || 'table',
        },
        width: 'half',
        height: 'medium',
      },
      userId,
    );

    // 4) 把 turnArtifact 的结果直接作为初始 snapshot（避免打开看板还要跑一次 SQL）
    if (artifact.resultColumns && artifact.resultRows) {
      widget.resultSnapshot = {
        columns: artifact.resultColumns as Array<{ name: string; type: string }>,
        rows: artifact.resultRows as Record<string, any>[],
        rowCount: artifact.resultRowCount ?? artifact.resultRows.length,
        refreshedAt: new Date().toISOString(),
      };
      await this.widgetRepo.save(widget);
    }

    // 5) 顺手让 AI 脱聚合生成明细 SQL 固化 —— 下载明细时秒回，AI 解读也能拿明细样本
    // 失败静默：不阻塞保存主流程
    try {
      const suggestion = await this.suggestDetailSql.suggest(artifact.finalSql);
      widget.detailSql = suggestion.isAlreadyDetail ? '' : suggestion.detailSql;
      await this.widgetRepo.save(widget);
      this.logger.log(
        `Widget ${widget.id} detailSql pre-generated: ${suggestion.isAlreadyDetail ? '(same as sql)' : suggestion.changes.join(' | ')}`,
      );
    } catch (err) {
      this.logger.warn(
        `Widget ${widget.id} detailSql pre-generate failed (will fallback at export time): ${(err as Error).message}`,
      );
    }

    this.logger.log(
      `Saved turn ${input.messageId} → widget ${widget.id} on dashboard ${dashboard.id}`,
    );
    return { dashboard, widget };
  }

  /**
   * 打开看板时刷新单个 widget — 跑 SQL，更新 resultSnapshot
   *
   * paramValues 由 dashboard 顶部 filter 面板传入；未传时用每个 param 的 default
   * 未持久化 paramValues —— 每个用户看板可能有不同 filter，短期用 URL query 承载
   */
  async refresh(id: string, userId: string, paramValues?: Record<string, any>): Promise<Widget> {
    const w = await this.getAccessibleWidget(id, userId);
    // dataset 模式：校验用户仍能访问这些 dataset
    if (w.datasetIds && w.datasetIds.length > 0) {
      for (const did of w.datasetIds) {
        await this.datasetService.getAccessible(did, userId); // 抛 Forbidden 若无权
      }
    }
    // 跑 SQL
    if (!w.datasourceId) {
      throw new BadRequestException('widget 缺少 datasourceId 无法执行');
    }
    // 参数化：把 {{key}} 替换成实际值（严格类型校验）
    const renderedSql = this.sqlTemplate.render(w.sql, w.params, paramValues || {});
    try {
      const result = await this.sqlExecutor.execute(renderedSql, w.datasourceId, {
        userId,
        maxRows: 1000,
      });
      w.resultSnapshot = {
        columns: result.columns,
        rows: result.rows,
        rowCount: result.rowCount,
        refreshedAt: new Date().toISOString(),
      };
      w.updatedAt = new Date();
      return this.widgetRepo.save(w);
    } catch (err) {
      this.logger.warn(`Widget ${id} refresh failed: ${(err as Error).message}`);
      throw err;
    }
  }

  /**
   * 下载 widget 数据 — 拿到 rows/columns 后由 controller 流式写响应
   *
   * mode='display'（默认）: 跑 widget 自身 SQL（聚合 top N，与图表一致）
   * mode='detail':        LLM 脱聚合 → 跑底表明细 SQL（如果 widget.detailSql 已固化则直接用）
   *
   * 明细 maxRows 降到 20000 —— 超过就上流式，或走异步任务（当前不做）
   */
  async prepareExport(
    id: string,
    userId: string,
    mode: 'display' | 'detail' = 'display',
    paramValues?: Record<string, any>,
  ): Promise<{
    columns: Array<{ name: string; type: string }>;
    rows: Record<string, any>[];
    filename: (ext: string) => string;
    mode: 'display' | 'detail';
    detailChanges?: string[];
    truncated: boolean;
  }> {
    const w = await this.getAccessibleWidget(id, userId);
    if (!w.datasourceId) {
      throw new BadRequestException('widget 缺少 datasourceId 无法执行');
    }

    let sqlToRun = w.sql;
    let detailChanges: string[] | undefined;
    if (mode === 'detail') {
      // 优先用 widget 上已固化的 detailSql；否则调 LLM 现场脱聚合
      if ((w as any).detailSql) {
        sqlToRun = (w as any).detailSql;
        detailChanges = ['使用 widget 保存时固化的明细 SQL'];
      } else {
        const suggestion = await this.suggestDetailSql.suggest(w.sql);
        sqlToRun = suggestion.detailSql;
        detailChanges = suggestion.changes;
        this.logger.log(
          `Widget ${id} export mode=detail; LLM changes=${suggestion.changes.join(' | ')}`,
        );
      }
    }

    // 明细 20k / 图表 5k —— 避免拉过大结果打爆内存
    const cap = mode === 'detail' ? 20000 : 5000;

    const defaults: Record<string, any> = {};
    if (w.params) {
      for (const p of w.params) {
        if (p.default !== undefined) defaults[p.key] = p.default;
      }
    }
    const merged = { ...defaults, ...(paramValues || {}) };
    const renderedSql = this.sqlTemplate.render(sqlToRun, w.params, merged);

    const result = await this.sqlExecutor.execute(renderedSql, w.datasourceId, {
      userId,
      maxRows: cap,
      useCache: false,
    });

    const columns = result.columns.map((c) => ({ name: c.name, type: c.type }));
    const base = w.title.replace(/[\\/:*?"<>|\r\n]/g, '_').substring(0, 100) || 'widget';
    const safe = mode === 'detail' ? `${base}-明细` : base;

    return {
      columns,
      rows: result.rows,
      filename: (ext) => `${safe}${ext}`,
      mode,
      detailChanges,
      truncated: result.rows.length >= cap,
    };
  }

  async getAccessibleWidget(id: string, userId: string): Promise<Widget> {
    const w = await this.widgetRepo.findOne({ where: { id } });
    if (!w) throw new NotFoundException('Widget 不存在');
    await this.dashboardService.getAccessible(w.dashboardId, userId); // 抛 Forbidden 若无权
    return w;
  }
}
