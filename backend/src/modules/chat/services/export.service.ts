import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Response } from 'express';
import * as ExcelJS from 'exceljs';
import { Conversation, Message } from '../../../database/entities';
import { SqlExecutorService } from '../../../core/sql-engine/sql-executor.service';

export type ExportFormat = 'csv' | 'excel' | 'markdown';

interface ResolvedMessage {
  message: Message;
  conversation: Conversation;
  sql: string;
  /** 业务名映射 (label -> 业务名)，从 metadata 取 */
  columnDisplayMap: Record<string, string>;
  /** 用户问题（取 message.content 上一条 user 消息）*/
  userQuestion: string;
  /** narrative / insights / lineage 等供 markdown 报告使用 */
  metadata: Record<string, any>;
}

/**
 * 「导出全量」服务
 *
 * 设计原则：
 *   - **不**经过 LLM。直接读 message.sql_text，重新执行一次拿真实数据
 *   - 使用独立上限 SQL_EXPORT_MAX_ROWS（默认 100k），单独超时配置
 *   - 仍走 SqlSafetyService 校验 + 数据源连接器，不绕开任何安全机制
 *   - 流式写出，不在内存里把整个文件 buffer 起来
 */
@Injectable()
export class ChatExportService {
  private readonly logger = new Logger(ChatExportService.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly executor: SqlExecutorService,
    @InjectRepository(Message)
    private readonly messageRepo: Repository<Message>,
    @InjectRepository(Conversation)
    private readonly conversationRepo: Repository<Conversation>,
  ) {}

  private get exportMaxRows(): number {
    return this.configService.get<number>('app.sql.exportMaxRows') || 100000;
  }

  private get exportTimeout(): number {
    return this.configService.get<number>('app.sql.exportTimeout') || 120;
  }

  /** 共用：拉取并校验消息，准备导出上下文 */
  private async resolveMessage(messageId: string): Promise<ResolvedMessage> {
    const message = await this.messageRepo.findOne({ where: { id: messageId } });
    if (!message) throw new NotFoundException(`Message ${messageId} not found`);
    if (message.role !== 'assistant') {
      throw new BadRequestException('只有 assistant 消息可以导出');
    }
    if (!message.sqlText || !message.sqlText.trim()) {
      throw new BadRequestException('该消息没有 SQL，无法导出（可能是拒答路径）');
    }
    const conversation = await this.conversationRepo.findOne({
      where: { id: message.conversationId },
    });
    if (!conversation) throw new NotFoundException('Conversation not found');
    if (!conversation.datasourceId) {
      throw new BadRequestException('对话未关联数据源，无法导出');
    }

    // 取这条 assistant 前一条 user 消息作为「问题」
    const prevUser = await this.messageRepo
      .createQueryBuilder('m')
      .where('m.conversation_id = :cid', { cid: message.conversationId })
      .andWhere('m.created_at < :ts', { ts: message.createdAt })
      .andWhere('m.role = :role', { role: 'user' })
      .orderBy('m.created_at', 'DESC')
      .getOne();

    const metadata = (message.metadata as Record<string, any>) || {};

    return {
      message,
      conversation,
      sql: message.sqlText,
      columnDisplayMap: (metadata.columnDisplayMap as Record<string, string>) || {},
      userQuestion: prevUser?.content || '(未找到对应用户问题)',
      metadata,
    };
  }

  /**
   * 执行 SQL 拿全量数据。
   * **不**剥离用户原 SQL 里的 LIMIT — 如果用户/LLM 在 SQL 里写了 LIMIT 10，
   * 导出也只会得到 10 行。如果想要"绕开 LLM 的 LIMIT 拿全量"，
   * 调用方需要传 stripLimit=true。
   */
  private async runExportSql(
    sql: string,
    datasourceId: string,
    stripLimit: boolean,
  ): Promise<{
    columns: { name: string; type: string }[];
    rows: Record<string, any>[];
    rowCount: number;
    truncated: boolean;
  }> {
    let effectiveSql = sql;
    if (stripLimit) {
      // 仅剥掉**结尾**的 LIMIT N（不动嵌套子查询里的 LIMIT，避免改坏语义）
      effectiveSql = sql.replace(/\s+LIMIT\s+\d+\s*;?\s*$/i, '').replace(/;\s*$/, '');
    }
    const result = await this.executor.execute(effectiveSql, datasourceId, {
      maxRows: this.exportMaxRows,
      timeoutSec: this.exportTimeout,
      useCache: false,
    });
    return {
      columns: result.columns,
      rows: result.rows,
      rowCount: result.rowCount,
      truncated: result.truncated,
    };
  }

  /** ============ CSV 流式 ============ */
  async exportCsv(
    messageId: string,
    res: Response,
    options: { stripLimit?: boolean } = {},
  ): Promise<void> {
    const ctx = await this.resolveMessage(messageId);
    const data = await this.runExportSql(
      ctx.sql,
      ctx.conversation.datasourceId!,
      !!options.stripLimit,
    );

    const filename = this.buildFilename(ctx, 'csv');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${encodeURIComponent(filename)}"`,
    );

    // UTF-8 BOM 避免 Excel 打开中文乱码
    res.write('﻿');

    const headers = data.columns.map((c) => this.translateHeader(c.name, ctx.columnDisplayMap));
    res.write(headers.map((h) => this.csvEscape(h)).join(',') + '\n');

    for (const row of data.rows) {
      const line = data.columns
        .map((c) => this.csvEscape(formatCell(row[c.name])))
        .join(',');
      res.write(line + '\n');
    }
    res.end();
    this.logger.log(`CSV exported: msg=${messageId} rows=${data.rowCount}`);
  }

  /** ============ Excel 流式 ============ */
  async exportExcel(
    messageId: string,
    res: Response,
    options: { stripLimit?: boolean } = {},
  ): Promise<void> {
    const ctx = await this.resolveMessage(messageId);
    const data = await this.runExportSql(
      ctx.sql,
      ctx.conversation.datasourceId!,
      !!options.stripLimit,
    );

    const filename = this.buildFilename(ctx, 'xlsx');
    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${encodeURIComponent(filename)}"`,
    );

    const wb = new ExcelJS.stream.xlsx.WorkbookWriter({
      stream: res as any,
      useStyles: true,
      useSharedStrings: false,
    });

    // Sheet 1: 数据
    const dataSheet = wb.addWorksheet('数据');
    dataSheet.columns = data.columns.map((c) => ({
      header: this.translateHeader(c.name, ctx.columnDisplayMap),
      key: c.name,
      width: 18,
    }));
    dataSheet.getRow(1).font = { bold: true };
    dataSheet.getRow(1).fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFE6F4FF' },
    };
    for (const row of data.rows) {
      const out: Record<string, any> = {};
      for (const col of data.columns) {
        out[col.name] = formatCellForExcel(row[col.name]);
      }
      dataSheet.addRow(out).commit();
    }
    dataSheet.commit();

    // Sheet 2: 查询信息（SQL + 时间 + 来源 + narrative）
    const metaSheet = wb.addWorksheet('查询信息');
    const metaRows: [string, any][] = [
      ['用户问题', ctx.userQuestion],
      ['Skill', ctx.metadata.skillName || '-'],
      ['执行 SQL', ctx.sql],
      ['Narrative', ctx.message.content],
      ['导出时间', new Date().toISOString()],
      ['总行数', data.rowCount],
      ['是否被导出上限截断', data.truncated ? `是 (${this.exportMaxRows})` : '否'],
    ];
    metaSheet.columns = [
      { header: '字段', key: 'k', width: 18 },
      { header: '值', key: 'v', width: 80 },
    ];
    metaSheet.getRow(1).font = { bold: true };
    for (const [k, v] of metaRows) {
      metaSheet
        .addRow({ k, v: typeof v === 'string' ? v : String(v) })
        .commit();
    }
    metaSheet.commit();

    await wb.commit();
    this.logger.log(`Excel exported: msg=${messageId} rows=${data.rowCount}`);
  }

  /** ============ Markdown 综合报告 ============ */
  async exportMarkdown(
    messageId: string,
    res: Response,
    options: { stripLimit?: boolean; includeRows?: number } = {},
  ): Promise<void> {
    const ctx = await this.resolveMessage(messageId);
    const data = await this.runExportSql(
      ctx.sql,
      ctx.conversation.datasourceId!,
      !!options.stripLimit,
    );

    const includeRows = Math.min(options.includeRows ?? 200, data.rows.length);
    const lines: string[] = [];
    lines.push(`# 数据分析报告`);
    lines.push('');
    lines.push(`**导出时间**: ${new Date().toLocaleString('zh-CN')}`);
    lines.push(`**使用 Skill**: ${ctx.metadata.skillName || '-'} ${ctx.metadata.skillVersion ? `v${ctx.metadata.skillVersion}` : ''}`);
    lines.push(`**置信度**: ${ctx.metadata.confidence != null ? Math.round(ctx.metadata.confidence * 100) + '%' : '-'}`);
    lines.push('');
    lines.push(`## 1. 用户问题`);
    lines.push('');
    lines.push(`> ${ctx.userQuestion}`);
    lines.push('');
    lines.push(`## 2. 答复`);
    lines.push('');
    lines.push(ctx.message.content);
    lines.push('');

    const insights = ctx.metadata.insights as any[] | undefined;
    if (insights?.length) {
      lines.push(`## 3. 主动洞见`);
      lines.push('');
      for (const i of insights) {
        const sev = i.severity === 'critical' ? '🔴' : i.severity === 'warning' ? '🟡' : '🔵';
        lines.push(`- ${sev} ${i.text}`);
      }
      lines.push('');
    }

    const followUps = ctx.metadata.suggestedFollowUps as string[] | undefined;
    if (followUps?.length) {
      lines.push(`## 4. 建议追问`);
      lines.push('');
      for (const f of followUps) lines.push(`- ${f}`);
      lines.push('');
    }

    lines.push(`## 5. 数据明细`);
    lines.push('');
    lines.push(`**总行数**: ${data.rowCount}${data.truncated ? `（已被导出上限 ${this.exportMaxRows} 截断）` : ''}`);
    lines.push(`**报告内展示**: 前 ${includeRows} 行（更多请用 CSV / Excel 拿全量）`);
    lines.push('');
    const headers = data.columns.map((c) => this.translateHeader(c.name, ctx.columnDisplayMap));
    lines.push(`| ${headers.join(' | ')} |`);
    lines.push(`| ${headers.map(() => '---').join(' | ')} |`);
    for (let i = 0; i < includeRows; i++) {
      const row = data.rows[i];
      const cells = data.columns.map((c) => mdEscape(formatCell(row[c.name])));
      lines.push(`| ${cells.join(' | ')} |`);
    }
    lines.push('');

    lines.push(`## 6. 执行 SQL`);
    lines.push('');
    lines.push('```sql');
    lines.push(ctx.sql);
    lines.push('```');
    lines.push('');

    const lineage = ctx.metadata.lineage as any[] | undefined;
    if (lineage?.length) {
      lines.push(`## 7. 数据血缘`);
      lines.push('');
      for (const l of lineage) {
        lines.push(`- **${l.table}** · 约 ${l.rowCountDisplay || '?'} 行 · 活动 ${l.lastActivityDisplay || '?'}`);
      }
      lines.push('');
    }

    lines.push(`---`);
    lines.push(`由 ChatBI 自动生成`);

    const filename = this.buildFilename(ctx, 'md');
    res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${encodeURIComponent(filename)}"`,
    );
    res.write('﻿');
    res.write(lines.join('\n'));
    res.end();
    this.logger.log(`Markdown report exported: msg=${messageId} rows=${data.rowCount}`);
  }

  // ============ helpers ============

  private buildFilename(ctx: ResolvedMessage, ext: string): string {
    const base = (ctx.userQuestion || 'chatbi-export')
      .replace(/[\\/:*?"<>|]/g, '_')
      .substring(0, 40);
    const stamp = new Date().toISOString().substring(0, 19).replace(/[:T]/g, '-');
    return `${base}_${stamp}.${ext}`;
  }

  private translateHeader(name: string, displayMap: Record<string, string>): string {
    return displayMap[name] || name;
  }

  private csvEscape(v: string): string {
    if (v == null) return '';
    if (/[",\n]/.test(v)) return `"${v.replace(/"/g, '""')}"`;
    return v;
  }
}

function formatCell(v: any): string {
  if (v == null) return '';
  if (v instanceof Date) return v.toISOString();
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

function formatCellForExcel(v: any): any {
  if (v == null) return '';
  if (v instanceof Date) return v;
  if (typeof v === 'object') return JSON.stringify(v);
  return v;
}

function mdEscape(s: string): string {
  return s.replace(/\|/g, '\\|').replace(/\n/g, ' ');
}
