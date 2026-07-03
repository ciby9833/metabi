import { Injectable, Logger } from '@nestjs/common';
import * as Papa from 'papaparse';
import * as ExcelJS from 'exceljs';
import { DatasetColumn } from '../../../database/entities';

/** 推断结果（解析阶段产出，给 schema 确认页用）*/
export interface ParsedDataset {
  /** 推断 + sanitize 后的列定义 */
  columns: DatasetColumn[];
  /** 总行数（不含表头）*/
  rowCount: number;
  /** 前 200 行（preview / sample 用；不入库时丢弃）*/
  sampleRows: Record<string, any>[];
  /** 全部行 — 入库阶段才用；preview 阶段可不返回（避免大对象） */
  allRows?: Record<string, any>[];
}

const SAMPLE_LIMIT = 200;

/**
 * 解析上传的 CSV / Excel 并推断列类型。
 *
 * 设计：
 *  - 推断在内存中跑 sample（前 500 行）— 大文件不会爆内存
 *  - 列名 sanitize：中文允许在 displayName，PG 列名转 lower_underscore_ascii
 *  - 重复列名自动加 _2 _3
 *  - 空值识别：'', null, 'N/A', '-', 'NULL', 'null'
 */
@Injectable()
export class DatasetParserService {
  private readonly logger = new Logger(DatasetParserService.name);

  /** 入口 — 按 MIME 路由 */
  async parse(
    buffer: Buffer,
    mime: string,
    filename: string,
  ): Promise<ParsedDataset> {
    if (mime.includes('csv') || filename.toLowerCase().endsWith('.csv')) {
      return this.parseCsv(buffer);
    }
    if (mime.includes('spreadsheet') || /\.(xlsx|xls)$/i.test(filename)) {
      return this.parseExcel(buffer);
    }
    throw new Error(`Unsupported file type: ${mime} (${filename})`);
  }

  // ============ CSV ============
  private parseCsv(buffer: Buffer): ParsedDataset {
    // 处理 BOM
    let text = buffer.toString('utf8');
    if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);

    const result = Papa.parse<Record<string, any>>(text, {
      header: true,
      skipEmptyLines: 'greedy',
      dynamicTyping: false, // 我们自己推断，避免 papaparse 把 '00123' 变成 123
    });
    if (result.errors && result.errors.length > 0) {
      this.logger.warn(
        `CSV parse warnings (first 3): ${result.errors
          .slice(0, 3)
          .map((e) => `${e.type}:${e.message}`)
          .join('; ')}`,
      );
    }

    const headers = (result.meta.fields || []) as string[];
    const rows = result.data as Record<string, any>[];
    return this.buildResult(headers, rows);
  }

  // ============ Excel ============
  private async parseExcel(buffer: Buffer): Promise<ParsedDataset> {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer as any);
    const ws = wb.worksheets[0]; // 暂时只支持第 1 个 sheet（多 sheet 后期扩）
    if (!ws) throw new Error('Excel file has no worksheet');

    // 第 1 行作为表头
    const headerRow = ws.getRow(1);
    const headers: string[] = [];
    headerRow.eachCell((cell, col) => {
      headers[col - 1] = String(cell.value ?? `col_${col}`);
    });

    const rows: Record<string, any>[] = [];
    ws.eachRow((row, rowIdx) => {
      if (rowIdx === 1) return; // skip header
      const obj: Record<string, any> = {};
      headers.forEach((h, i) => {
        const cell = row.getCell(i + 1);
        obj[h] = this.normalizeExcelCell(cell.value);
      });
      // 跳过全空行
      if (Object.values(obj).every((v) => v == null || v === '')) return;
      rows.push(obj);
    });

    return this.buildResult(headers, rows);
  }

  private normalizeExcelCell(v: any): any {
    if (v == null) return null;
    if (typeof v === 'object') {
      if ('text' in v) return v.text; // rich text
      if ('result' in v) return v.result; // formula
      if (v instanceof Date) return v.toISOString();
    }
    return v;
  }

  // ============ 列推断 + sanitize ============
  private buildResult(
    rawHeaders: string[],
    rows: Record<string, any>[],
  ): ParsedDataset {
    if (rawHeaders.length === 0) {
      throw new Error('No columns detected (empty header row?)');
    }
    if (rows.length === 0) {
      throw new Error('No data rows detected');
    }

    // sanitize 列名 + 去重
    const sanitized = this.sanitizeHeaders(rawHeaders);

    // 对每列推断类型 + 计算 nullRatio
    const sampleForInfer = rows.slice(0, 500);
    const columns: DatasetColumn[] = sanitized.map((h, i) => {
      const original = rawHeaders[i];
      const values = sampleForInfer.map((r) => r[original]);
      const type = this.inferType(values);
      const sample = values
        .filter((v) => v != null && v !== '')
        .slice(0, 5);
      const nullCount = values.filter((v) => this.isNullish(v)).length;
      const nullRatio = sampleForInfer.length > 0 ? nullCount / sampleForInfer.length : 0;
      return {
        name: h,
        originalName: original !== h ? original : undefined,
        type,
        sample,
        nullRatio,
      };
    });

    // 把原始列名映射到 sanitize 后的列名
    const allRows = rows.map((r) => {
      const out: Record<string, any> = {};
      sanitized.forEach((newName, i) => {
        out[newName] = r[rawHeaders[i]];
      });
      return out;
    });

    return {
      columns,
      rowCount: rows.length,
      sampleRows: allRows.slice(0, SAMPLE_LIMIT),
      allRows,
    };
  }

  // ============ helpers ============

  private isNullish(v: any): boolean {
    if (v == null) return true;
    if (typeof v !== 'string') return false;
    const t = v.trim().toLowerCase();
    return t === '' || t === 'null' || t === 'n/a' || t === '-' || t === 'na' || t === 'nil';
  }

  /**
   * 类型推断 — 多数表决：>= 80% 的非空值能解析为某类型则定为该类型。
   * 优先级：boolean > integer > numeric > timestamp > date > text
   *
   * 重要：integer 推断后**还要检查范围**，超过 int32 (2^31-1) 自动降级 numeric，
   * 避免 COPY 时报 "out of range for type integer" 错（运单号/订单号常超）
   */
  private inferType(values: any[]): DatasetColumn['type'] {
    const nonNull = values.filter((v) => !this.isNullish(v));
    if (nonNull.length === 0) return 'text';

    const counts = { boolean: 0, integer: 0, numeric: 0, timestamp: 0, date: 0 };
    let maxAbs = 0;
    for (const v of nonNull) {
      const s = String(v).trim();
      if (this.isBoolean(s)) counts.boolean++;
      if (this.isInteger(s)) {
        counts.integer++;
        const n = Math.abs(parseInt(s, 10));
        if (n > maxAbs) maxAbs = n;
      }
      if (this.isNumeric(s)) counts.numeric++;
      if (this.isTimestamp(s)) counts.timestamp++;
      else if (this.isDate(s)) counts.date++;
    }

    const threshold = Math.ceil(nonNull.length * 0.8);
    const INT32_MAX = 2147483647;
    // 优先级判断
    if (counts.boolean >= threshold) return 'boolean';
    if (counts.integer >= threshold) {
      // 超 int32 → 用 numeric 兜底（PG numeric 任意精度），避免 out of range
      return maxAbs > INT32_MAX ? 'numeric' : 'integer';
    }
    if (counts.numeric >= threshold) return 'numeric';
    if (counts.timestamp >= threshold) return 'timestamp';
    if (counts.date >= threshold) return 'date';
    return 'text';
  }

  private isBoolean(s: string): boolean {
    return /^(true|false|yes|no|0|1|是|否)$/i.test(s);
  }
  private isInteger(s: string): boolean {
    // 排除前导 0（保留为字符串，避免破坏电话号码等）
    if (/^0\d+/.test(s)) return false;
    return /^-?\d+$/.test(s);
  }
  private isNumeric(s: string): boolean {
    // 允许整数 + 小数 + 科学计数
    if (/^0\d+/.test(s)) return false;
    return /^-?\d+(\.\d+)?([eE][+-]?\d+)?$/.test(s);
  }
  private isDate(s: string): boolean {
    return /^\d{4}-\d{2}-\d{2}$/.test(s) || /^\d{4}\/\d{1,2}\/\d{1,2}$/.test(s);
  }
  private isTimestamp(s: string): boolean {
    return /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/.test(s);
  }

  /**
   * 列名 sanitize：
   *   "客户姓名"     → "客户姓名"  ❌ 不行，PG 默认列名要 ascii 引号才能用中文
   *   "Customer Name" → "customer_name"
   *   "f-1"          → "f_1"
   *   重复 → 后缀 _2 _3
   *   空 → "col_N"
   *
   * 中文转拼音 / 业务名做不到，所以中文列名一律转 "col_N"，但原名记录在 originalName。
   * LLM 通过 metadata 的 description 知道中文业务含义。
   */
  private sanitizeHeaders(raw: string[]): string[] {
    const out: string[] = [];
    const used = new Set<string>();

    raw.forEach((name, idx) => {
      let n = (name || '').trim();
      // 全 ASCII 字母数字下划线 → 直接 lower
      let safe = n
        .toLowerCase()
        .replace(/[^a-z0-9_]+/g, '_')
        .replace(/^_+|_+$/g, '');
      // 中文 / 全 sanitize 后空 → col_N
      if (!safe || /^\d/.test(safe)) safe = `col_${idx + 1}`;
      // 截 63（PG 标识符上限）
      safe = safe.substring(0, 63);
      // 去重
      let final = safe;
      let suffix = 2;
      while (used.has(final)) {
        const suf = `_${suffix}`;
        final = safe.substring(0, 63 - suf.length) + suf;
        suffix++;
      }
      used.add(final);
      out.push(final);
    });

    return out;
  }
}
