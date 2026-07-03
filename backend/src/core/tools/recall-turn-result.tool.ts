import { Injectable } from '@nestjs/common';
import { TurnRecallService } from '../../modules/chat/services/turn-recall.service';
import { AgentTool, ToolContext, ToolDefinition } from './tool.types';

interface Input {
  turn_index: number;
  limit?: number;
}

interface Output {
  ok: boolean;
  turnIndex?: number;
  finalSql?: string | null;
  columns?: { name: string; type: string }[];
  rows?: Record<string, any>[];
  totalRowCount?: number;
  truncated?: boolean;
  error?: string;
}

@Injectable()
export class RecallTurnResultTool implements AgentTool<Input, Output> {
  readonly definition: ToolDefinition = {
    name: 'recall_turn_result',
    description:
      '拉取某一历史轮次执行 SQL 的真实结果数据（具体行）。' +
      '场景：用户问「上一轮 Top 1 的站点叫什么」、「按照之前那 5 个站点继续」等需要引用前轮具体值的时候。' +
      '默认返回前 50 行，可用 limit 调整（最大 1000）。',
    parameters: {
      type: 'object',
      properties: {
        turn_index: {
          type: 'integer',
          minimum: 1,
          description: '轮次序号，从 1 开始；先用 list_previous_turns 查清有哪些轮次',
        },
        limit: {
          type: 'integer',
          minimum: 1,
          maximum: 1000,
          description: '返回最多多少行，默认 50',
        },
      },
      required: ['turn_index'],
      additionalProperties: false,
    },
  };

  constructor(private readonly recall: TurnRecallService) {}

  async execute(input: Input, ctx: ToolContext): Promise<Output> {
    if (!ctx.conversationId) {
      return { ok: false, error: '当前没有对话上下文' };
    }
    const limit = Math.min(input.limit || 50, 1000);
    const result = await this.recall.getResultRows(
      ctx.conversationId,
      input.turn_index,
      limit,
    );
    if (!result) {
      return { ok: false, error: `轮次 ${input.turn_index} 不存在` };
    }
    return {
      ok: true,
      turnIndex: result.turnIndex,
      finalSql: result.finalSql,
      columns: result.columns,
      rows: result.rows,
      totalRowCount: result.totalRowCount,
      truncated: result.truncated,
    };
  }
}
