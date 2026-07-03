import { Injectable } from '@nestjs/common';
import { TurnRecallService } from '../../modules/chat/services/turn-recall.service';
import { AgentTool, ToolContext, ToolDefinition } from './tool.types';

interface Input {}

interface Output {
  totalTurns: number;
  turns: {
    turnIndex: number;
    question: string;
    finalSql: string | null;
    rowCount: number | null;
    narrativeSnippet: string;
    refused: boolean;
  }[];
  hint: string;
}

@Injectable()
export class ListPreviousTurnsTool implements AgentTool<Input, Output> {
  readonly definition: ToolDefinition = {
    name: 'list_previous_turns',
    description:
      '列出本对话之前所有轮次的概要（不含完整数据）。当用户提出下钻 / 追问、需要复用之前的查询或结果时，先调这个看历史。' +
      '返回每一轮的 turnIndex / 用户问题 / 当时的 SQL / 行数 / 播报摘要。',
    parameters: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
  };

  constructor(private readonly recall: TurnRecallService) {}

  async execute(_input: Input, ctx: ToolContext): Promise<Output> {
    if (!ctx.conversationId) {
      return {
        totalTurns: 0,
        turns: [],
        hint: '当前没有对话上下文（这是会话的第一轮），无历史可看。',
      };
    }
    const turns = await this.recall.listTurns(ctx.conversationId);
    return {
      totalTurns: turns.length,
      turns,
      hint:
        turns.length === 0
          ? '这是本对话的第一轮，无历史。'
          : `历史共 ${turns.length} 轮。需要查某一轮的真实数据用 recall_turn_result(turnIndex=...)，要复看完整 tool 调用过程用 recall_turn_messages(turnIndex=...)。`,
    };
  }
}
