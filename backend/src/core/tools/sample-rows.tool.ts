import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Datasource } from '../../database/entities';
import { ConnectorFactory } from '../../providers/connector/connector.factory';
import { SqlSafetyService } from '../sql-engine/sql-safety.service';
import { AgentTool, ToolContext, ToolDefinition } from './tool.types';

interface Input {
  table: string;
  schema?: string;
  n?: number;
  /** 可选 WHERE 过滤（去掉 WHERE 关键字，例：source_date >= '2026-05-17'） */
  where?: string;
}
interface Output {
  table: string;
  schema: string;
  rowCount: number;
  rows: Record<string, any>[];
}

@Injectable()
export class SampleRowsTool implements AgentTool<Input, Output> {
  readonly definition: ToolDefinition = {
    name: 'sample_rows',
    description:
      '从指定表抓 N 行真实数据（默认 5 行）查看字段的实际取值。极其重要：列名可能是泛词（status/type），必须看真值才知道枚举。',
    parameters: {
      type: 'object',
      properties: {
        table: { type: 'string', description: '表名' },
        schema: { type: 'string', description: '可选 schema' },
        n: { type: 'integer', minimum: 1, maximum: 50, description: '行数，默认 5，最大 50' },
        where: {
          type: 'string',
          description: '可选 WHERE 子句（不含 WHERE 关键字），用于过滤特定子集',
        },
      },
      required: ['table'],
      additionalProperties: false,
    },
  };

  constructor(
    private readonly connectorFactory: ConnectorFactory,
    private readonly safety: SqlSafetyService,
    @InjectRepository(Datasource)
    private readonly datasourceRepo: Repository<Datasource>,
  ) {}

  async execute(input: Input, ctx: ToolContext): Promise<Output> {
    const ds = await this.datasourceRepo.findOneOrFail({ where: { id: ctx.datasourceId } });
    const connector = this.connectorFactory.getConnector(ds.id, ds.type, ds.config as any);
    // 自动识别 schema-qualified 输入
    let table = input.table;
    let inferredSchema: string | undefined = input.schema;
    if (table.includes('.')) {
      const parts = table.split('.');
      inferredSchema = inferredSchema || parts[0];
      table = parts[1];
    }
    const schema: string = inferredSchema || (ds.config as any).schema || 'public';

    // 白名单防御：与 list_tables / run_sql 一致
    if (ctx.allowedTables && ctx.allowedTables.length > 0) {
      const fullName = `${schema}.${table}`.toLowerCase();
      const allowedFull = new Set(ctx.allowedTables.map((t) => t.toLowerCase()));
      const allowedShort = new Set(
        ctx.allowedTables.map((t) =>
          (t.includes('.') ? t.split('.')[1] : t).toLowerCase(),
        ),
      );
      if (!allowedFull.has(fullName) && !allowedShort.has(table.toLowerCase())) {
        throw new Error(
          `表 ${fullName} 不在白名单。可用表：${ctx.allowedTables.join(', ')}`,
        );
      }
    }

    const n = Math.min(Math.max(input.n || 5, 1), 50);
    const whereClause = input.where ? `WHERE ${input.where}` : '';
    const sql = `SELECT * FROM ${schema}.${table} ${whereClause} LIMIT ${n}`;
    this.safety.validate(sql);
    const result = await connector.execute(sql, { maxRows: n, timeoutSec: 10 });
    return {
      table,
      schema,
      rowCount: result.rowCount,
      rows: result.rows,
    };
  }
}
