import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { OrchestrateResult } from '../../core/orchestrator/chat-orchestrator.service';

/**
 * 飞书推送服务
 *
 * 支持两种推送方式：
 *  1. 文本消息（msg_type: text）
 *  2. 富文本卡片（msg_type: interactive）
 *
 * MVP 阶段优先实现卡片消息，包含：标题、播报文本、SQL 折叠、跳转看板按钮
 */
@Injectable()
export class FeishuService {
  private readonly logger = new Logger(FeishuService.name);
  private readonly defaultWebhook?: string;

  constructor(private readonly configService: ConfigService) {
    this.defaultWebhook = this.configService.get<string>('app.feishu.webhookUrl');
  }

  /** 发送文本消息 */
  async sendText(text: string, webhook?: string): Promise<void> {
    const url = webhook || this.defaultWebhook;
    if (!url) {
      this.logger.warn('No Feishu webhook configured; skipping push');
      return;
    }
    await this.post(url, {
      msg_type: 'text',
      content: { text },
    });
  }

  /** 发送任务结果卡片 */
  async sendTaskResult(
    options: {
      taskName: string;
      question: string;
      result: OrchestrateResult;
      dashboardUrl?: string;
    },
    webhook?: string,
  ): Promise<void> {
    const url = webhook || this.defaultWebhook;
    if (!url) {
      this.logger.warn('No Feishu webhook configured; skipping task result push');
      return;
    }
    const card = this.buildTaskCard(options);
    await this.post(url, {
      msg_type: 'interactive',
      card,
    });
  }

  /** 发送任务失败告警 */
  async sendTaskFailure(
    taskName: string,
    question: string,
    error: string,
    webhook?: string,
  ): Promise<void> {
    const url = webhook || this.defaultWebhook;
    if (!url) return;
    const card = {
      config: { wide_screen_mode: true },
      header: {
        title: { tag: 'plain_text', content: `❌ 任务失败：${taskName}` },
        template: 'red',
      },
      elements: [
        {
          tag: 'div',
          text: {
            tag: 'lark_md',
            content: `**问题**\n${question}\n\n**错误**\n\`${error}\``,
          },
        },
      ],
    };
    await this.post(url, { msg_type: 'interactive', card });
  }

  private buildTaskCard(options: {
    taskName: string;
    question: string;
    result: OrchestrateResult;
    dashboardUrl?: string;
  }): Record<string, any> {
    const { taskName, question, result, dashboardUrl } = options;
    const elements: any[] = [
      {
        tag: 'div',
        text: { tag: 'lark_md', content: `**问题**\n${question}` },
      },
      { tag: 'hr' },
      {
        tag: 'div',
        text: { tag: 'lark_md', content: `**分析结论**\n${result.narrative}` },
      },
      {
        tag: 'div',
        fields: [
          {
            is_short: true,
            text: {
              tag: 'lark_md',
              content: `**返回行数**\n${result.resultSummary.rowCount.toLocaleString()}${
                result.resultSummary.truncated ? '+' : ''
              }`,
            },
          },
          {
            is_short: true,
            text: {
              tag: 'lark_md',
              content: `**执行耗时**\n${result.resultSummary.executionTimeMs} ms${
                result.resultSummary.fromCache ? ' (缓存)' : ''
              }`,
            },
          },
          {
            is_short: true,
            text: {
              tag: 'lark_md',
              content: `**置信度**\n${(result.confidence * 100).toFixed(0)}%`,
            },
          },
          {
            is_short: true,
            text: {
              tag: 'lark_md',
              content: `**Skill**\n${result.provenance?.skill?.name || '-'}`,
            },
          },
        ],
      },
    ];

    // 可选：表格预览（前 5 行）
    if (result.data.rows.length > 0) {
      const preview = this.formatTablePreview(result.data, 5);
      elements.push(
        { tag: 'hr' },
        {
          tag: 'div',
          text: { tag: 'lark_md', content: `**结果预览**\n\`\`\`\n${preview}\n\`\`\`` },
        },
      );
    }

    // 可选：跳转看板按钮
    if (dashboardUrl) {
      elements.push({
        tag: 'action',
        actions: [
          {
            tag: 'button',
            text: { tag: 'plain_text', content: '查看完整看板' },
            type: 'primary',
            url: dashboardUrl,
          },
        ],
      });
    }

    return {
      config: { wide_screen_mode: true },
      header: {
        title: { tag: 'plain_text', content: `📊 ${taskName}` },
        template: 'blue',
      },
      elements,
    };
  }

  private formatTablePreview(
    data: { columns: { name: string }[]; rows: Record<string, any>[] },
    limit = 5,
  ): string {
    const headers = data.columns.map((c) => c.name).join(' | ');
    const sep = data.columns.map(() => '---').join(' | ');
    const rows = data.rows.slice(0, limit).map((row) =>
      data.columns
        .map((c) => {
          const v = row[c.name];
          if (v === null || v === undefined) return '-';
          if (typeof v === 'number') return Number.isInteger(v) ? String(v) : v.toFixed(2);
          return String(v).substring(0, 30);
        })
        .join(' | '),
    );
    return [headers, sep, ...rows].join('\n');
  }

  private async post(url: string, body: Record<string, any>): Promise<void> {
    try {
      const res = await axios.post(url, body, { timeout: 10_000 });
      if (res.data?.code !== 0 && res.data?.StatusCode !== 0) {
        this.logger.warn(`Feishu API returned non-zero code: ${JSON.stringify(res.data)}`);
      } else {
        this.logger.debug(`Feishu push success`);
      }
    } catch (err) {
      this.logger.error(`Feishu push failed: ${(err as Error).message}`);
      throw err;
    }
  }
}
