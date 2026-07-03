import { Injectable, Logger } from '@nestjs/common';
import * as ExcelJS from 'exceljs';
import * as fs from 'fs';
import type { Writable } from 'stream';
import PDFDocument = require('pdfkit');

export interface ExportTableInput {
  /** 列定义 — name 是字段名，可选 displayName 是表头用 */
  columns: Array<{ name: string; type?: string; displayName?: string }>;
  rows: Record<string, any>[];
  /** Sheet 名（仅 Excel；CSV 忽略）*/
  sheetName?: string;
  /** PDF 标题（不传用 sheetName / 'Data Export'）*/
  title?: string;
  /** PDF 描述子文本（生成者/日期/来源等）*/
  subtitle?: string;
}

export interface ExportResult {
  buffer: Buffer;
  mimeType: string;
  extension: string;
}

/**
 * 数据 → Excel / CSV buffer。
 *
 * 设计：
 *   - 列宽自动估算（按 displayName + 前 N 行平均长度）
 *   - 数字直接写为 number，日期写为 Date — Excel 自动识别类型
 *   - CSV 用 RFC 4180 转义（双引号 / 逗号 / 换行）
 */
@Injectable()
export class ExporterService {
  private readonly logger = new Logger(ExporterService.name);
  private readonly MAX_ROWS = 100000;
  /** PDF 中文字体路径（可选环境变量）*/
  private readonly cjkFontPath = process.env.PDF_CJK_FONT_PATH;
  private cjkFontWarned = false;

  async toExcel(input: ExportTableInput): Promise<ExportResult> {
    const wb = new ExcelJS.Workbook();
    wb.creator = 'ChatBI';
    wb.created = new Date();
    const ws = wb.addWorksheet(input.sheetName || 'Sheet1');

    const rows = input.rows.slice(0, this.MAX_ROWS);
    const colDefs = input.columns.map((c) => ({
      header: c.displayName || c.name,
      key: c.name,
      width: this.estimateColWidth(c, rows),
    }));
    ws.columns = colDefs;

    // 表头加粗 + 底色
    ws.getRow(1).font = { bold: true };
    ws.getRow(1).fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFF0F0F0' },
    };

    // 写数据 — 自动按列 key 提取，缺失值留空
    for (const row of rows) {
      const out: Record<string, any> = {};
      for (const c of input.columns) {
        out[c.name] = this.normalizeCell(row[c.name], c.type);
      }
      ws.addRow(out);
    }

    // freeze 表头
    ws.views = [{ state: 'frozen', xSplit: 0, ySplit: 1 }];

    const arrayBuffer = await wb.xlsx.writeBuffer();
    return {
      buffer: Buffer.from(arrayBuffer as ArrayBuffer),
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      extension: '.xlsx',
    };
  }

  /**
   * 数据 → PDF buffer
   *
   * 布局：A4 竖版；标题 + 描述 + 表格（自动分页）+ 页码。
   *
   * 中文字体：
   *   - 有 PDF_CJK_FONT_PATH env 且文件存在 → 用它注册为 CJK 字体
   *   - 无 → 用 pdfkit 默认 Helvetica（英文数字 OK，中文显示为空/乱码）
   *     首次时 warn 提示用户配置字体
   *
   * @returns Promise<ExportResult> — pdfkit 是 stream-based，必须 await 完成
   */
  async toPdf(input: ExportTableInput): Promise<ExportResult> {
    const rows = input.rows.slice(0, this.MAX_ROWS);
    const doc = new PDFDocument({
      size: 'A4',
      margin: 40,
      info: {
        Title: input.title || 'ChatBI Export',
        Creator: 'ChatBI',
      },
    });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));

    // 尝试加载中文字体
    const useCjk = this.tryRegisterCjkFont(doc);
    doc.font(useCjk ? 'CJK' : 'Helvetica');

    // 标题
    doc.fontSize(18).fillColor('#000').text(input.title || 'Data Export', {
      align: 'left',
    });
    doc.moveDown(0.3);
    if (input.subtitle) {
      doc.fontSize(10).fillColor('#666').text(input.subtitle);
    }
    doc.fontSize(9).fillColor('#999').text(
      `导出时间 ${new Date().toLocaleString('zh-CN')} · 共 ${rows.length.toLocaleString()} 行`,
    );
    doc.moveDown(0.8);

    // 表格
    this.drawPdfTable(doc, input.columns, rows, useCjk);

    // 分页页码（在最后所有页写）
    const pageCount = doc.bufferedPageRange().count;
    for (let i = 0; i < pageCount; i++) {
      doc.switchToPage(i);
      doc
        .fontSize(8)
        .fillColor('#aaa')
        .text(
          `${i + 1} / ${pageCount}`,
          doc.page.margins.left,
          doc.page.height - 20,
          { width: doc.page.width - doc.page.margins.left - doc.page.margins.right, align: 'right' },
        );
    }

    doc.end();
    const buffer = await new Promise<Buffer>((resolve, reject) => {
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);
    });

    return {
      buffer,
      mimeType: 'application/pdf',
      extension: '.pdf',
    };
  }

  toCsv(input: ExportTableInput): ExportResult {
    const rows = input.rows.slice(0, this.MAX_ROWS);
    const lines: string[] = [];
    // 表头
    lines.push(input.columns.map((c) => this.csvEscape(c.displayName || c.name)).join(','));
    // 数据
    for (const row of rows) {
      lines.push(
        input.columns
          .map((c) => this.csvEscape(this.normalizeCell(row[c.name], c.type)))
          .join(','),
      );
    }
    // BOM + UTF-8（Excel 双击打开识别中文）
    const text = '﻿' + lines.join('\r\n');
    return {
      buffer: Buffer.from(text, 'utf8'),
      mimeType: 'text/csv; charset=utf-8',
      extension: '.csv',
    };
  }

  /**
   * 流式 xlsx 导出 —— 用 ExcelJS 的 WorkbookWriter 直接把 xlsx 分块写到 writable
   *
   * 优点：不 buffer 整个 workbook 到内存，10 万行大表也不会 OOM
   * 局限：不支持 freeze / column width 精确估算（stream mode 下有部分限制）
   */
  async toExcelStream(input: ExportTableInput, writable: Writable): Promise<{ rowsWritten: number }> {
    const wb = new ExcelJS.stream.xlsx.WorkbookWriter({
      stream: writable,
      useStyles: true,
    });
    wb.creator = 'ChatBI';
    wb.created = new Date();
    const ws = wb.addWorksheet(input.sheetName || 'Sheet1');

    ws.columns = input.columns.map((c) => ({
      header: c.displayName || c.name,
      key: c.name,
      width: 20,
    }));
    // 表头样式
    const headerRow = ws.getRow(1);
    headerRow.font = { bold: true };
    headerRow.commit();

    let rowsWritten = 0;
    const cap = Math.min(input.rows.length, this.MAX_ROWS);
    for (let i = 0; i < cap; i++) {
      const row = input.rows[i];
      const out: Record<string, any> = {};
      for (const c of input.columns) {
        out[c.name] = this.normalizeCell(row[c.name], c.type);
      }
      ws.addRow(out).commit();
      rowsWritten++;
    }

    ws.commit();
    await wb.commit();
    return { rowsWritten };
  }

  /**
   * 流式 CSV 导出 —— 逐行 write 到 writable，避免拼接大字符串
   *
   * 优点：内存平坦；能处理任意大结果
   */
  toCsvStream(input: ExportTableInput, writable: Writable): { rowsWritten: number } {
    // BOM 让 Excel 识别 UTF-8
    writable.write('﻿');
    // 表头
    writable.write(
      input.columns.map((c) => this.csvEscape(c.displayName || c.name)).join(',') + '\r\n',
    );

    let rowsWritten = 0;
    const cap = Math.min(input.rows.length, this.MAX_ROWS);
    for (let i = 0; i < cap; i++) {
      const row = input.rows[i];
      const line = input.columns
        .map((c) => this.csvEscape(this.normalizeCell(row[c.name], c.type)))
        .join(',');
      writable.write(line + '\r\n');
      rowsWritten++;
    }
    return { rowsWritten };
  }

  // ============ helpers ============

  private normalizeCell(v: any, type?: string): any {
    if (v == null || v === '') return '';
    if (type === 'date' || type === 'timestamp') {
      // 尽量还原 Date 对象，让 Excel 识别为日期格式
      const d = new Date(v);
      return Number.isNaN(d.getTime()) ? String(v) : d;
    }
    if (type === 'integer' || type === 'numeric') {
      const n = Number(v);
      return Number.isFinite(n) ? n : String(v);
    }
    return v;
  }

  private estimateColWidth(
    col: { name: string; displayName?: string },
    rows: Record<string, any>[],
  ): number {
    const header = col.displayName || col.name;
    let max = Math.min(40, header.length * 2);
    for (const r of rows.slice(0, 50)) {
      const len = String(r[col.name] ?? '').length;
      if (len > max) max = Math.min(40, len);
    }
    return Math.max(8, max + 2);
  }

  private csvEscape(v: any): string {
    if (v == null) return '';
    const s = String(v);
    if (/[",\r\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  }

  // ============ PDF helpers ============

  /** 尝试注册中文字体；成功返回 true。失败首次 warn 一次不重复。*/
  private tryRegisterCjkFont(doc: PDFKit.PDFDocument): boolean {
    if (!this.cjkFontPath) {
      if (!this.cjkFontWarned) {
        this.logger.warn(
          'PDF_CJK_FONT_PATH not configured — PDFs will not render Chinese. ' +
            'Provide a TTF/OTF font file path via env to enable CJK.',
        );
        this.cjkFontWarned = true;
      }
      return false;
    }
    if (!fs.existsSync(this.cjkFontPath)) {
      if (!this.cjkFontWarned) {
        this.logger.warn(
          `PDF_CJK_FONT_PATH file not found: ${this.cjkFontPath} — falling back to Helvetica`,
        );
        this.cjkFontWarned = true;
      }
      return false;
    }
    try {
      doc.registerFont('CJK', this.cjkFontPath);
      return true;
    } catch (err) {
      this.logger.warn(`Failed to register CJK font: ${(err as Error).message}`);
      return false;
    }
  }

  /** 简单表格：等宽列 + 自动分页；避免手写复杂 layout */
  private drawPdfTable(
    doc: PDFKit.PDFDocument,
    columns: Array<{ name: string; displayName?: string }>,
    rows: Record<string, any>[],
    useCjk: boolean,
  ): void {
    if (columns.length === 0 || rows.length === 0) {
      doc.fontSize(10).fillColor('#999').text('(无数据)');
      return;
    }

    const pageWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
    const colWidth = pageWidth / columns.length;
    const rowHeight = 18;
    const headerFontSize = 9;
    const cellFontSize = 8;
    const bottomLimit = doc.page.height - doc.page.margins.bottom - 30; // 留位给页码

    const drawHeader = () => {
      const y = doc.y;
      doc
        .rect(doc.page.margins.left, y, pageWidth, rowHeight)
        .fillAndStroke('#f0f0f0', '#d9d9d9');
      doc.fillColor('#000').font(useCjk ? 'CJK' : 'Helvetica').fontSize(headerFontSize);
      columns.forEach((c, i) => {
        doc.text(
          this.truncatePdfCell(c.displayName || c.name, 30),
          doc.page.margins.left + i * colWidth + 4,
          y + 4,
          { width: colWidth - 8, ellipsis: true, lineBreak: false },
        );
      });
      doc.y = y + rowHeight;
    };

    drawHeader();

    doc.fontSize(cellFontSize).fillColor('#333');
    let rowIdx = 0;
    for (const row of rows) {
      if (doc.y + rowHeight > bottomLimit) {
        doc.addPage();
        drawHeader();
        doc.fontSize(cellFontSize).fillColor('#333');
      }
      const y = doc.y;
      // 交替行底色
      if (rowIdx % 2 === 1) {
        doc.rect(doc.page.margins.left, y, pageWidth, rowHeight).fillAndStroke('#fafafa', '#eee');
      } else {
        doc.rect(doc.page.margins.left, y, pageWidth, rowHeight).stroke('#eee');
      }
      doc.fillColor('#333');
      columns.forEach((c, i) => {
        const val = row[c.name];
        const text = val == null ? '' : String(val);
        doc.text(this.truncatePdfCell(text, 60), doc.page.margins.left + i * colWidth + 4, y + 5, {
          width: colWidth - 8,
          ellipsis: true,
          lineBreak: false,
        });
      });
      doc.y = y + rowHeight;
      rowIdx++;
    }
  }

  private truncatePdfCell(s: string, maxLen: number): string {
    if (s.length <= maxLen) return s;
    return s.substring(0, maxLen - 1) + '…';
  }
}
