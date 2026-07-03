import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { LLMGatewayService } from '../../../providers/llm/llm-gateway.service';
import { LLMScenario } from '../../../providers/llm/types';
import { DashboardService } from './dashboard.service';
import { WidgetService } from './widget.service';
import type { Widget } from '../../../database/entities';

export interface DashboardInterpretation {
  summary: string;
  anomalies: Array<{ widget: string; description: string }>;
  correlations: Array<{ widgets: string[]; description: string }>;
  recommendations: Array<{ action: string; description: string }>;
  meta: {
    widgetCount: number;
    dataRowsScanned: number;
    generatedAt: string;
  };
}

export interface WidgetInterpretation {
  conclusion: string;
  keyFindings: string[];
  anomalies: Array<{ item: string; description: string }>;
  nextQuestions: string[];
  meta: {
    widgetTitle: string;
    rowsScanned: number;
    generatedAt: string;
  };
}

/**
 * Dashboard 综合 AI 解读
 *
 * 把整个看板的所有 widget 结果打包给 LLM →
 * 生成跨图综合洞见（异常、关联、下一步建议）
 *
 * 与单 widget 的 narrative 不同 —— 这里追求"横向对比 + 跨图推断"
 *
 * 关键约束：
 *   1) 只用样本行（前 20），避免 prompt 撑爆
 *   2) 明确禁止瞎编 —— "只基于给出的数据说话，不知道就说不知道"
 *   3) 返回结构化 JSON，前端可编排展示
 */
@Injectable()
export class DashboardInterpretService {
  private readonly logger = new Logger(DashboardInterpretService.name);
  private static readonly SAMPLE_ROWS = 20;

  constructor(
    private readonly dashboardService: DashboardService,
    private readonly widgetService: WidgetService,
    private readonly llm: LLMGatewayService,
  ) {}

  async interpret(
    dashboardId: string,
    userId: string,
    paramValues?: Record<string, any>,
  ): Promise<DashboardInterpretation> {
    const dashboard = await this.dashboardService.getAccessible(dashboardId, userId);
    const widgets = await this.widgetService.listForDashboard(dashboardId, userId);

    if (widgets.length === 0) {
      throw new BadRequestException('看板还没有 widget，无法解读');
    }

    // 组装：每个 widget 的元信息 + 前 20 行样本
    const widgetSummaries = widgets.map((w) => this.summarizeWidget(w));
    const totalRows = widgetSummaries.reduce((s, w) => s + w.rowCount, 0);

    const prompt = this.buildPrompt(dashboard.name, widgetSummaries, paramValues || {});
    const response = await this.llm.call(
      [
        {
          role: 'system',
          content:
            '你是资深数据分析师。基于给出的看板数据，输出结构化 JSON 综合洞见。' +
            '硬约束：\n' +
            '- 只使用 <widgets> 里给出的数据，禁止引用外部知识或猜测\n' +
            '- 数字必须来自数据本身，不虚构\n' +
            '- 观察不到的信息就说"数据不足"，不要凑\n' +
            '- 输出必须是纯 JSON（不要 markdown 包裹），schema 见 <output_schema>',
        },
        { role: 'user', content: prompt },
      ],
      { scenario: LLMScenario.NARRATIVE, temperature: 0.3 },
    );

    const raw = response.content?.trim() || '';
    const parsed = this.parseResponse(raw);
    return {
      ...parsed,
      meta: {
        widgetCount: widgets.length,
        dataRowsScanned: totalRows,
        generatedAt: new Date().toISOString(),
      },
    };
  }

  private summarizeWidget(w: Widget) {
    const snap = w.resultSnapshot;
    return {
      id: w.id,
      title: w.title,
      description: w.description,
      chartType: w.chartConfig?.type || 'table',
      columns: snap?.columns || [],
      sampleRows: (snap?.rows || []).slice(0, DashboardInterpretService.SAMPLE_ROWS),
      rowCount: snap?.rowCount || 0,
      refreshedAt: snap?.refreshedAt || null,
    };
  }

  private buildPrompt(
    dashboardName: string,
    widgets: ReturnType<DashboardInterpretService['summarizeWidget']>[],
    paramValues: Record<string, any>,
  ): string {
    const widgetsXml = widgets
      .map(
        (w) => `<widget>
  <title>${w.title}</title>
  ${w.description ? `<description>${w.description}</description>` : ''}
  <chart_type>${w.chartType}</chart_type>
  <columns>${JSON.stringify(w.columns.map((c) => ({ name: c.name, type: c.type })))}</columns>
  <row_count>${w.rowCount}</row_count>
  <sample_rows>${JSON.stringify(w.sampleRows)}</sample_rows>
</widget>`,
      )
      .join('\n');

    const filterInfo =
      Object.keys(paramValues).length > 0
        ? `<current_filters>${JSON.stringify(paramValues)}</current_filters>`
        : '<current_filters>（未应用筛选）</current_filters>';

    return `<dashboard_name>${dashboardName}</dashboard_name>
${filterInfo}

<widgets>
${widgetsXml}
</widgets>

<output_schema>
{
  "summary": "一段综合概述，2-4 句话，串联 widgets 揭示的主要故事",
  "anomalies": [
    { "widget": "widget 标题", "description": "具体异常描述，含数字" }
  ],
  "correlations": [
    { "widgets": ["widget标题A", "widget标题B"], "description": "两图/多图之间的关联发现" }
  ],
  "recommendations": [
    { "action": "简短动作", "description": "为什么建议，2-3 句" }
  ]
}
</output_schema>

要求：
- summary 必填；异常/关联/建议每一项都可能空数组
- anomalies 关注：突变、极值、增速反常
- correlations 关注：跨 widget 一致或矛盾的信号
- recommendations 关注：下一步该看什么、验证什么、调整什么
- 只输出 JSON 对象，无任何前后缀`;
  }

  /**
   * 单 widget 深度解读 — 纵向深挖
   *
   * 与整版解读（横向对比）不同，这里：
   *   - 更多样本行（前 40）
   *   - 输出 keyFindings（一句话核心结论 + 3-5 个细节）
   *   - 推荐下钻问题（可直接复用为 chat 追问）
   */
  async interpretWidget(widgetId: string, userId: string): Promise<WidgetInterpretation> {
    const w = await this.widgetService.getAccessibleWidget(widgetId, userId);
    const snap = w.resultSnapshot;
    if (!snap || snap.rows.length === 0) {
      throw new BadRequestException('该 widget 尚未刷新出数据，无法解读');
    }
    const sampleRows = snap.rows.slice(0, 40);

    const prompt = `<widget>
  <title>${w.title}</title>
  ${w.description ? `<description>${w.description}</description>` : ''}
  <chart_type>${w.chartConfig?.type || 'table'}</chart_type>
  <columns>${JSON.stringify(snap.columns.map((c) => ({ name: c.name, type: c.type })))}</columns>
  <row_count>${snap.rowCount}</row_count>
  <sample_rows>${JSON.stringify(sampleRows)}</sample_rows>
</widget>

<output_schema>
{
  "conclusion": "一句话核心结论（含关键数字）",
  "keyFindings": ["细节发现1（含数字）", "细节发现2", "..."],
  "anomalies": [{ "item": "对象名/维度", "description": "为什么异常，含数字" }],
  "nextQuestions": ["建议下钻问题1", "..."]
}
</output_schema>

要求：
- conclusion 必填；其他每项可为空数组
- keyFindings 3-5 条，每条必须含具体数字
- anomalies 关注：极值、断层、明显偏离趋势的对象
- nextQuestions 3 条，用户问出来能进一步挖出洞见的方向
- 数字只能来自 sample_rows，不许瞎编
- 只输出 JSON，无前后缀`;

    const response = await this.llm.call(
      [
        {
          role: 'system',
          content:
            '你是资深数据分析师。基于给出的单个 widget 数据，做深度纵向解读。' +
            '硬约束：\n' +
            '- 只用 <widget> 里给出的数据说话，禁止外部知识\n' +
            '- 数字必须精确来自 sample_rows\n' +
            '- 观察不到就说"数据不足"\n' +
            '- 输出纯 JSON（无 markdown 包裹）',
        },
        { role: 'user', content: prompt },
      ],
      { scenario: LLMScenario.NARRATIVE, temperature: 0.3 },
    );

    const parsed = this.parseWidgetResponse(response.content?.trim() || '');
    return {
      ...parsed,
      meta: {
        widgetTitle: w.title,
        rowsScanned: sampleRows.length,
        generatedAt: new Date().toISOString(),
      },
    };
  }

  private parseWidgetResponse(raw: string): Omit<WidgetInterpretation, 'meta'> {
    let body = raw;
    if (body.startsWith('```')) {
      body = body.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
    }
    try {
      const j = JSON.parse(body);
      return {
        conclusion: String(j.conclusion || ''),
        keyFindings: Array.isArray(j.keyFindings) ? j.keyFindings.map(String) : [],
        anomalies: Array.isArray(j.anomalies) ? j.anomalies : [],
        nextQuestions: Array.isArray(j.nextQuestions) ? j.nextQuestions.map(String) : [],
      };
    } catch (err) {
      this.logger.warn(`Failed to parse widget interpret JSON: ${(err as Error).message}. Raw=${raw.substring(0, 200)}`);
      return {
        conclusion: raw || '解读失败：LLM 未返回有效 JSON',
        keyFindings: [],
        anomalies: [],
        nextQuestions: [],
      };
    }
  }

  private parseResponse(raw: string): Omit<DashboardInterpretation, 'meta'> {
    // 常见前缀清洗（防 LLM 加 ```json）
    let body = raw;
    if (body.startsWith('```')) {
      body = body.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
    }
    try {
      const j = JSON.parse(body);
      return {
        summary: String(j.summary || ''),
        anomalies: Array.isArray(j.anomalies) ? j.anomalies : [],
        correlations: Array.isArray(j.correlations) ? j.correlations : [],
        recommendations: Array.isArray(j.recommendations) ? j.recommendations : [],
      };
    } catch (err) {
      this.logger.warn(`Failed to parse interpret JSON: ${(err as Error).message}. Raw=${raw.substring(0, 200)}`);
      return {
        summary: raw || '解读失败：LLM 未返回有效 JSON',
        anomalies: [],
        correlations: [],
        recommendations: [],
      };
    }
  }
}
