import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Datasource } from '../../database/entities';
import { ConnectorFactory } from '../../providers/connector/connector.factory';
import { AgentTool, ToolContext, ToolDefinition } from './tool.types';

interface Input {
  schema?: string;
}
interface Output {
  schema: string;
  tables: string[];
  count: number;
}

@Injectable()
export class ListTablesTool implements AgentTool<Input, Output> {
  readonly definition: ToolDefinition = {
    name: 'list_tables',
    description:
      '列出数据源里所有可查询的表。可选参数 schema 限定到某个 schema（PostgreSQL）；不传则使用数据源默认 schema。',
    parameters: {
      type: 'object',
      properties: {
        schema: { type: 'string', description: '可选：schema 名，例如 "dwd" / "public"' },
      },
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
    const schema = input.schema || (ds.config as any).schema || 'public';
    const allTables = await connector.listTables(schema);

    // Skill 白名单过滤
    let tables = allTables;
    if (ctx.allowedTables && ctx.allowedTables.length > 0) {
      const allowedBare = new Set(
        ctx.allowedTables.map((t) => (t.includes('.') ? t.split('.')[1] : t)),
      );
      tables = allTables.filter((t) => allowedBare.has(t));
    }

    // 始终返回 schema-qualified 名（schema.table），避免 LLM 写 SQL 时遗漏 schema
    const qualified = tables.map((t) => `${schema}.${t}`);
    return { schema, tables: qualified, count: qualified.length };
  }
}
