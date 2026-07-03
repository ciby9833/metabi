import { Injectable, Logger } from '@nestjs/common';
import { AgentTool, ToolContext, ToolDefinition } from './tool.types';
import { FileStorageService } from '../../modules/exports/services/file-storage.service';
import { ExporterService } from '../../modules/exports/services/exporter.service';
import { SqlExecutorService } from '../sql-engine/sql-executor.service';
import { SqlSafetyService } from '../sql-engine/sql-safety.service';

/**
 * 文件导出工具 — Excel / CSV
 *
 * 设计原则（context-aligned）：
 *   - availability: 'both' — 两种数据模式都暴露
 *   - 不强制 LLM 何时调；prompt 描述了「什么时候用 / 什么时候不用」让 LLM 自决
 *   - 返回 fileId — LLM 在 finalize 时把它写到 narrative，前端展示附件 chip
 *
 * 白名单：跟 run_sql 工具用同样的逻辑（dataset/skill 表白名单）
 */

interface ExportInput {
  format: 'excel' | 'csv' | 'pdf';
  filename: string;
  sql: string;
  description?: string;
}

interface ExportOutput {
  ok: boolean;
  fileId?: string;
  filename?: string;
  rowCount?: number;
  sizeBytes?: number;
  mimeType?: string;
  error?: string;
}

@Injectable()
export class ExportTableTool implements AgentTool<ExportInput, ExportOutput> {
  private readonly logger = new Logger(ExportTableTool.name);

  readonly definition: ToolDefinition = {
    name: 'export_table',
    description: [
      '把 SQL 查询结果导出为 Excel(.xlsx) / CSV(.csv) / PDF(.pdf) 文件，返回 fileId。',
      '何时用：',
      '- 用户明确要"导出/下载/做成 Excel/给我 .csv/.xlsx/PDF"',
      '- 用户想拿走数据给同事 / 离线查看 / 进一步处理',
      '- 结果数据行数 ≥ 20 且有保留价值',
      '何时不用：',
      '- 用户只想"看一眼"答案 → 直接 finalize 即可',
      '- 数据 < 5 行 → narrative 讲清楚就好',
      '格式选择建议：',
      '- Excel：需要再加工/公式/图表',
      '- CSV：程序处理 / 兼容任何工具',
      '- PDF：适合打印 / 发邮件 / 存档报告',
      '调用后在 finalize 的 narrative 里简短说"已生成附件"。',
      '前端会自动展示附件下载 chip — 不需要在 narrative 里贴 fileId。',
    ].join('\n'),
    parameters: {
      type: 'object',
      properties: {
        format: {
          type: 'string',
          enum: ['excel', 'csv', 'pdf'],
          description:
            'excel = .xlsx（含格式化）；csv = 纯文本（最兼容）；pdf = 适合打印/存档报告',
        },
        filename: {
          type: 'string',
          description: '用户友好的文件名（不含扩展名），如「客户订单-2026-05」',
        },
        sql: {
          type: 'string',
          description: '要导出的数据的 SQL；通常与你刚才 run_sql 的 SQL 一致或更详细',
        },
        description: {
          type: 'string',
          description: '一句话说明这个文件的内容（展示在附件 chip 旁边）',
        },
      },
      required: ['format', 'filename', 'sql'],
      additionalProperties: false,
    },
    availability: 'both',
  };

  constructor(
    private readonly storage: FileStorageService,
    private readonly exporter: ExporterService,
    private readonly sqlExecutor: SqlExecutorService,
    private readonly safety: SqlSafetyService,
  ) {}

  async execute(input: ExportInput, ctx: ToolContext): Promise<ExportOutput> {
    if (!ctx.userId) {
      return { ok: false, error: '未登录用户无法导出文件' };
    }

    // 1) Safety
    try {
      this.safety.validate(input.sql);
    } catch (err) {
      return { ok: false, error: `SQL 安全校验失败：${(err as Error).message}` };
    }

    // 2) Whitelist（与 run_sql 工具同源；用最朴素的字符串匹配兜底）
    if (ctx.allowedTables && ctx.allowedTables.length > 0) {
      const sqlLower = input.sql.toLowerCase();
      const referencedAny = ctx.allowedTables.some((t) => sqlLower.includes(t.toLowerCase()));
      if (!referencedAny) {
        return {
          ok: false,
          error:
            `❌ 导出 SQL 未引用任何允许的表。可用表：${ctx.allowedTables.join(', ')}\n` +
            '请改 SQL 至少 FROM 一个允许的表后重试。',
        };
      }
    }

    // 3) 跑 SQL
    let result: { columns: any[]; rows: any[]; rowCount: number };
    try {
      const r = await this.sqlExecutor.execute(input.sql, ctx.datasourceId, {
        userId: ctx.userId,
        conversationId: ctx.conversationId,
        maxRows: 100000, // 导出场景允许更大行数
      });
      result = { columns: r.columns, rows: r.rows, rowCount: r.rowCount };
    } catch (err) {
      return { ok: false, error: `SQL 执行失败：${(err as Error).message}` };
    }

    if (result.rowCount === 0) {
      return { ok: false, error: '查询结果为 0 行，没必要导出' };
    }

    // 4) 导出
    const exportInput = {
      columns: result.columns.map((c: any) => ({ name: c.name, type: c.type })),
      rows: result.rows,
      sheetName: this.truncate(input.filename, 31),
      title: input.filename,
      subtitle: input.description,
    };
    let exported;
    if (input.format === 'excel') {
      exported = await this.exporter.toExcel(exportInput);
    } else if (input.format === 'pdf') {
      exported = await this.exporter.toPdf(exportInput);
    } else {
      exported = this.exporter.toCsv(exportInput);
    }

    // 5) 保存
    const safeFilename = this.sanitizeFilename(input.filename) + exported.extension;
    try {
      const file = await this.storage.save({
        ownerId: ctx.userId,
        conversationId: ctx.conversationId,
        filename: safeFilename,
        mimeType: exported.mimeType,
        buffer: exported.buffer,
        description: input.description,
      });
      this.logger.log(
        `Exported ${safeFilename} (${result.rowCount} rows, ${exported.buffer.byteLength}B) → ${file.id}`,
      );
      return {
        ok: true,
        fileId: file.id,
        filename: safeFilename,
        rowCount: result.rowCount,
        sizeBytes: exported.buffer.byteLength,
        mimeType: exported.mimeType,
      };
    } catch (err) {
      return { ok: false, error: `保存文件失败：${(err as Error).message}` };
    }
  }

  private sanitizeFilename(name: string): string {
    return (
      name
        .trim()
        .replace(/[\\/:*?"<>|]/g, '_')
        .substring(0, 200) || 'export'
    );
  }

  private truncate(s: string, maxLen: number): string {
    return s.length > maxLen ? s.substring(0, maxLen) : s;
  }
}
