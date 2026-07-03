import { Injectable } from '@nestjs/common';
import { TurnRecallService } from '../../modules/chat/services/turn-recall.service';
import { AgentTool, ToolContext, ToolDefinition } from './tool.types';

interface Input {
  turn_index: number;
}

interface SummarizedStep {
  role: string;
  name?: string;
  arguments?: any;
  content?: string;
}

interface Output {
  ok: boolean;
  turnIndex?: number;
  steps?: SummarizedStep[];
  error?: string;
  hint?: string;
}

/**
 * 拉某轮完整 ConversationMessage[]，但**摘要展示给 LLM**（不要原样回灌 tool_use / tool_result）。
 *
 * 原因：原样回灌会让 LLM 把那些当成"我自己刚才调的工具"，导致 tool-call id 错配等问题。
 * 这里把它格式化成普通 JSON 摘要，让 LLM 当作"读历史"而不是"我刚执行过"。
 */
@Injectable()
export class RecallTurnMessagesTool implements AgentTool<Input, Output> {
  readonly definition: ToolDefinition = {
    name: 'recall_turn_messages',
    description:
      '查看某一历史轮次完整的 tool 调用过程（list_tables 探到什么、sample_rows 看到哪些、SQL 怎么改过来的）。' +
      '场景：你要复盘前一轮思路，或确认前一轮某个字段含义时使用。',
    parameters: {
      type: 'object',
      properties: {
        turn_index: {
          type: 'integer',
          minimum: 1,
          description: '轮次序号',
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
    const raw = await this.recall.getRawMessages(ctx.conversationId, input.turn_index);
    if (!raw) {
      return { ok: false, error: `轮次 ${input.turn_index} 不存在` };
    }
    const steps = this.summarize(raw);
    return {
      ok: true,
      turnIndex: input.turn_index,
      steps,
      hint: `共 ${steps.length} 步。如果要复用其中某次 SQL 的结果，请用 recall_turn_result。`,
    };
  }

  /**
   * 把原始 ConversationMessage[] 摘要成易读的步骤
   * - 跳过 system 块（避免重复 skill/metadata）
   * - assistant 的 tool_calls 展开成步骤
   * - tool_result 截断到 600 字符避免 token 爆
   */
  private summarize(msgs: any[]): SummarizedStep[] {
    const steps: SummarizedStep[] = [];
    for (const m of msgs) {
      if (m.role === 'system') continue;
      if (m.role === 'user') {
        steps.push({ role: 'user', content: this.truncate(m.content, 500) });
        continue;
      }
      if (m.role === 'assistant') {
        if (Array.isArray(m.toolCalls) && m.toolCalls.length > 0) {
          for (const tc of m.toolCalls) {
            steps.push({
              role: 'assistant_tool_call',
              name: tc.name,
              arguments: tc.arguments,
            });
          }
        }
        if (m.content) {
          steps.push({ role: 'assistant_text', content: this.truncate(m.content, 500) });
        }
        continue;
      }
      if (m.role === 'tool') {
        steps.push({
          role: 'tool_result',
          name: m.toolName,
          content: this.truncate(m.content, 600),
        });
        continue;
      }
    }
    return steps;
  }

  private truncate(s: any, max: number): string {
    if (s == null) return '';
    const str = typeof s === 'string' ? s : JSON.stringify(s);
    return str.length > max ? str.substring(0, max) + '...(truncated)' : str;
  }
}
