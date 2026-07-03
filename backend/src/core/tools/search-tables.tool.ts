import { Injectable } from '@nestjs/common';
import { SchemaIndexService } from '../../providers/schema-index/schema-index.service';
import { AgentTool, ToolContext, ToolDefinition } from './tool.types';

interface Input {
  /** 关键词，可以是用户问题原文 */
  query: string;
  /** Top k，默认 10 */
  k?: number;
}

interface Output {
  ok: boolean;
  results: {
    schema: string;
    table: string;
    column?: string;
    kind: 'table' | 'column';
    score: number;
    text: string;
  }[];
  hint: string;
  error?: string;
}

/**
 * 关键词搜索表/列（向量相似度）
 *
 * 大型数据仓库场景：list_tables 会返回上千张表，Agent 看不过来
 * 改用 search_tables(query) 直接拿 Top-k 候选
 *
 * 索引需要先 reindex（前端数据源管理 → 重建索引）
 */
@Injectable()
export class SearchTablesTool implements AgentTool<Input, Output> {
  readonly definition: ToolDefinition = {
    name: 'search_tables',
    description:
      '【大数据仓库专用】按关键词搜索最相关的表 / 列（向量相似度，含业务名/描述/同义词）。' +
      '替代 list_tables 用在表很多的场景。' +
      '如果数据源没建索引会返回空，那时退回 list_tables。',
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: '搜索关键词，可以直接用用户原问题',
        },
        k: { type: 'integer', minimum: 1, maximum: 30, description: 'Top k，默认 10' },
      },
      required: ['query'],
      additionalProperties: false,
    },
    // dataset 模式 schema 已完整在 prompt 中给出，且无向量索引
    availability: 'enterprise_only',
  };

  constructor(private readonly index: SchemaIndexService) {}

  async execute(input: Input, ctx: ToolContext): Promise<Output> {
    try {
      let results = await this.index.search(ctx.datasourceId, input.query, input.k || 10);

      // 白名单过滤：用户上传 dataset 模式下，仅返回 allowedTables 内的结果
      if (ctx.allowedTables && ctx.allowedTables.length > 0) {
        const allowed = new Set(ctx.allowedTables.map((t) => t.toLowerCase()));
        results = results.filter((r) => {
          const fullName = `${r.schemaName}.${r.tableName}`.toLowerCase();
          return allowed.has(fullName) || allowed.has(r.tableName.toLowerCase());
        });
      }

      return {
        ok: true,
        results: results.map((r) => ({
          schema: r.schemaName,
          table: r.tableName,
          column: r.columnName,
          kind: r.kind,
          score: Number(r.score.toFixed(3)),
          text: r.text,
        })),
        hint:
          results.length === 0
            ? '索引为空。请在数据源管理页面手动重建索引，或退回使用 list_tables。'
            : `找到 ${results.length} 个相关项目，按相似度排序。`,
      };
    } catch (err) {
      return {
        ok: false,
        results: [],
        hint: '搜索失败，请用 list_tables 退回',
        error: (err as Error).message,
      };
    }
  }
}
