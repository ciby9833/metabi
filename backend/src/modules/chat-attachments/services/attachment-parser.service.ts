import { Injectable, Logger } from '@nestjs/common';
import * as ExcelJS from 'exceljs';
import * as Papa from 'papaparse';
import * as fs from 'fs';

export type AttachmentKind = 'image' | 'table' | 'pdf' | 'text';

export interface ParsedAttachment {
  kind: AttachmentKind;
  preview: Record<string, any>;
}

/**
 * 附件解析器 — 把上传的文件转成 Planner 可用的 preview 结构
 *
 * 输出的 preview 会直接进入 LLM prompt / vision content block，
 * 所以要控制大小（防 token 打爆）：
 *   - image: 存 mime + sizeBytes，vision 时从磁盘按需读 base64
 *   - table: 前 100 行 + columns（超过时截断）
 *   - pdf:   前 3000 字 + pageCount
 *   - text:  前 3000 字 + lineCount
 */
@Injectable()
export class AttachmentParserService {
  private readonly logger = new Logger(AttachmentParserService.name);
  private static readonly TABLE_PREVIEW_ROWS = 100;
  private static readonly TEXT_PREVIEW_CHARS = 3000;

  async parse(
    filePath: string,
    filename: string,
    mimeType: string,
  ): Promise<ParsedAttachment> {
    const kind = this.detectKind(filename, mimeType);
    switch (kind) {
      case 'image':
        return this.parseImage(filePath, mimeType);
      case 'table':
        return this.parseTable(filePath, filename);
      case 'pdf':
        return this.parsePdf(filePath);
      case 'text':
      default:
        return this.parseText(filePath);
    }
  }

  detectKind(filename: string, mimeType: string): AttachmentKind {
    const lower = filename.toLowerCase();
    if (mimeType.startsWith('image/')) return 'image';
    if (mimeType === 'application/pdf' || lower.endsWith('.pdf')) return 'pdf';
    if (
      mimeType.includes('spreadsheet') ||
      lower.endsWith('.xlsx') ||
      lower.endsWith('.xls') ||
      lower.endsWith('.csv') ||
      mimeType === 'text/csv'
    ) {
      return 'table';
    }
    return 'text';
  }

  private async parseImage(filePath: string, mimeType: string): Promise<ParsedAttachment> {
    const stats = fs.statSync(filePath);
    return {
      kind: 'image',
      preview: { mime: mimeType, sizeBytes: stats.size },
    };
  }

  private async parseTable(filePath: string, filename: string): Promise<ParsedAttachment> {
    const isCsv = /\.csv$/i.test(filename);
    if (isCsv) {
      const text = fs.readFileSync(filePath, 'utf8');
      const result = Papa.parse<Record<string, any>>(text, {
        header: true,
        skipEmptyLines: true,
        dynamicTyping: false,
      });
      const rows = result.data;
      const columns = result.meta.fields?.map((f) => ({ name: f, type: this.inferType(rows, f) })) || [];
      return {
        kind: 'table',
        preview: {
          columns,
          rowCount: rows.length,
          sampleRows: rows.slice(0, AttachmentParserService.TABLE_PREVIEW_ROWS),
        },
      };
    }
    // xlsx
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(filePath);
    const ws = wb.worksheets[0];
    if (!ws) {
      return { kind: 'table', preview: { columns: [], rowCount: 0, sampleRows: [] } };
    }
    const headers: string[] = [];
    const firstRow = ws.getRow(1);
    firstRow.eachCell((cell, colNumber) => {
      headers[colNumber - 1] = String(cell.value ?? `col${colNumber}`);
    });
    const rows: Record<string, any>[] = [];
    for (let i = 2; i <= ws.rowCount && rows.length < AttachmentParserService.TABLE_PREVIEW_ROWS; i++) {
      const r = ws.getRow(i);
      const obj: Record<string, any> = {};
      for (let c = 1; c <= headers.length; c++) {
        obj[headers[c - 1]] = r.getCell(c).value;
      }
      rows.push(obj);
    }
    const columns = headers.map((h) => ({ name: h, type: this.inferType(rows, h) }));
    return {
      kind: 'table',
      preview: { columns, rowCount: ws.rowCount - 1, sampleRows: rows },
    };
  }

  private async parsePdf(filePath: string): Promise<ParsedAttachment> {
    try {
      const { PDFParse } = await import('pdf-parse');
      const buffer = fs.readFileSync(filePath);
      const parser = new PDFParse({ data: new Uint8Array(buffer) });
      const result = await parser.getText();
      const text = String(result.text || '').replace(/\s+/g, ' ').trim();
      return {
        kind: 'pdf',
        preview: {
          pageCount: result.total || 0,
          textPreview: text.substring(0, AttachmentParserService.TEXT_PREVIEW_CHARS),
          totalTextLength: text.length,
        },
      };
    } catch (err) {
      this.logger.warn(`PDF parse failed: ${(err as Error).message}`);
      return {
        kind: 'pdf',
        preview: { pageCount: 0, textPreview: '(PDF 解析失败，可能是扫描件或加密文档)', totalTextLength: 0 },
      };
    }
  }

  private async parseText(filePath: string): Promise<ParsedAttachment> {
    const text = fs.readFileSync(filePath, 'utf8');
    return {
      kind: 'text',
      preview: {
        lineCount: text.split('\n').length,
        textPreview: text.substring(0, AttachmentParserService.TEXT_PREVIEW_CHARS),
        totalTextLength: text.length,
      },
    };
  }

  /** 粗略推断列类型 — 只看前 20 行 */
  private inferType(rows: Record<string, any>[], col: string): string {
    let numCount = 0;
    let dateCount = 0;
    let sampled = 0;
    for (const r of rows.slice(0, 20)) {
      const v = r[col];
      if (v === null || v === undefined || v === '') continue;
      sampled++;
      if (typeof v === 'number' || (typeof v === 'string' && !isNaN(Number(v)))) numCount++;
      else if (v instanceof Date || /^\d{4}-\d{2}-\d{2}/.test(String(v))) dateCount++;
    }
    if (sampled === 0) return 'text';
    if (numCount / sampled > 0.8) return 'numeric';
    if (dateCount / sampled > 0.5) return 'date';
    return 'text';
  }
}
