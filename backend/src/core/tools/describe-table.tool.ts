import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Datasource } from '../../database/entities';
import { ConnectorFactory } from '../../providers/connector/connector.factory';
import { AgentTool, ToolContext, ToolDefinition } from './tool.types';

interface Input {
  table: string;
  schema?: string;
}
interface Output {
  table: string;
  schema: string;
  columns: { name: string; type: string; nullable?: boolean }[];
  rowCount?: number;
}

@Injectable()
export class DescribeTableTool implements AgentTool<Input, Output> {
  readonly definition: ToolDefinition = {
    name: 'describe_table',
    description:
      '获取指定表的结构：列名、数据类型、是否可空。写 SQL 前必须先调用此工具确认字段存在和类型。',
    parameters: {
      type: 'object',
      properties: {
        table: { type: 'string', description: '表名（不含 schema 前缀）' },
        schema: { type: 'string', description: '可选 schema 名' },
      },
      required: ['table'],
      additionalProperties: false,
    },
    // dataset 模式 schema 已完整在 prompt 中给出，无需此工具
    availability: 'enterprise_only',
  };

  constructor(
    private readonly connectorFactory: ConnectorFactory,
    @InjectRepository(Datasource)
    private readonly datasourceRepo: Repository<Datasource>,
  ) {}

  async execute(input: Input, ctx: ToolContext): Promise<Output> {
    const ds = await this.datasourceRepo.findOneOrFail({ where: { id: ctx.datasourceId } });
    const connector = this.connectorFactory.getConnector(ds.id, ds.type, ds.config as any);
    // 自动识别 schema-qualified 输入：table="dwd.waybill_detail" → schema=dwd, table=waybill_detail
    let table = input.table;
    let inferredSchema: string | undefined = input.schema;
    if (table.includes('.')) {
      const parts = table.split('.');
      inferredSchema = inferredSchema || parts[0];
      table = parts[1];
    }
    const schema: string = inferredSchema || (ds.config as any).schema || 'public';

    // 白名单防御：与 list_tables / run_sql 一致 — 仅允许 allowedTables 中的表
    // 防止用户上传 dataset 模式下，LLM 通过 prompt injection 探测他人表的 schema
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

    const desc = await connector.describeTable(table, schema);
    return {
      table: desc.name,
      schema: desc.schema || schema,
      columns: desc.columns,
    };
  }
}
