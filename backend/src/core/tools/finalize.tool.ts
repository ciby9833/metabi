import { Injectable } from '@nestjs/common';
import { AgentTool, FinalizePayload, ToolContext, ToolDefinition } from './tool.types';

/**
 * `finalize` 工具
 *
 * Planner 看到 LLM 调用此工具就停止 ReAct 循环。
 * 它本身不做事，只作为 LLM "我答完了"的信号载体。
 *
 * 两种使用模式：
 *  - 正常完结：传 sql + chartType + narrative + confidence
 *  - 拒答：传 refused=true + refuseReason，sql 可为空
 */
@Injectable()
export class FinalizeTool implements AgentTool<FinalizePayload, FinalizePayload> {
  readonly definition: ToolDefinition = {
    name: 'finalize',
    description:
      '完成本次分析。当你有了最终答案（或决定拒答），调用此工具结束循环。\n\n' +
      '⚠️ 你必须**同时**给出 insights（你发现的有意思的点）和 suggestedFollowUps（用户可能想问的下一个问题）。' +
      '这是这个系统价值的核心——不只是回答字面问题，还要主动挖掘和引导。',
    parameters: {
      type: 'object',
      properties: {
        sql: { type: 'string', description: '已经在 run_sql 中成功执行过的最终 SQL' },
        chartType: {
          type: 'string',
          enum: ['line', 'bar', 'pie', 'table', 'scatter', 'heatmap', 'auto'],
          description: '推荐图表类型',
        },
        narrative: {
          type: 'string',
          description: '给业务人员看的播报，3-5 句，含具体数字。**语言必须跟用户提问的语言一致**（中文问→中文答，英文问→英文答）。',
        },
        confidence: {
          type: 'number',
          minimum: 0,
          maximum: 1,
          description: '0..1 的置信度。低于 0.5 系统会触发拒答审查',
        },
        refused: { type: 'boolean', description: 'true=本次拒答（数据不足/概念不清等）' },
        refuseReason: {
          type: 'string',
          description: '拒答时必填：告诉用户为什么拒答 + 需要补充什么信息',
        },
        insights: {
          type: 'array',
          description:
            '你主动发现的有意思的点，每条一两句话。例如："5/22 比前几日均值高 38%，疑似促销日"、"DMK001D 站点占 Top 5 总量 42%，集中度偏高"。' +
            '正常应给出 1-3 条；如果结果完全平淡可以空。',
          items: {
            type: 'object',
            properties: {
              severity: {
                type: 'string',
                enum: ['info', 'warning', 'critical'],
                description: 'info=值得一看，warning=需要关注，critical=明显异常需立即关注',
              },
              text: { type: 'string', description: '一两句话描述这个发现' },
              kind: {
                type: 'string',
                enum: ['anomaly', 'concentration', 'data_quality', 'trend', 'business', 'attribution'],
                description: '类别',
              },
            },
            required: ['severity', 'text'],
          },
        },
        suggestedFollowUps: {
          type: 'array',
          description:
            '给业务人员的 3-5 个下钻建议问题，每条是完整的问题，可以直接当作下一轮提问。' +
            '**语言必须跟用户当前提问的语言一致**。' +
            '应基于本次结果中"值得继续挖"的点设计，例如：' +
            '"DMK001D 站点为什么单量这么高？"、"按时段拆分看看 Top 1 站点的派送分布"',
          items: { type: 'string' },
        },
        relatedHints: {
          type: 'array',
          description:
            '主动关联提示：用户没问到、但根据 Skill 的「关联指标」章节和当前数据值得提醒的"邻居"角度。' +
            '不是延伸问题，而是"你可能没意识到这件事也值得看"。' +
            '例：用户问"5/22 单量峰值"时，可以提示"5/22 准时签收率从 78% 跌到 65%，量大涨可能拖累了时效"。' +
            '只在能从结果+Skill 看出明显相关风险/机会时填，0-2 条即可，宁缺勿滥。',
          items: { type: 'string' },
        },
        clarify: {
          type: 'object',
          description:
            '⚠️ 关键澄清请求。**优先使用而非 refused / 而非硬猜**。当用户问题中存在以下歧义时使用：\n' +
            '  - 业务术语歧义：例「销量」可能是 count(distinct waybill_no) 或 sum(piece_count)\n' +
            '  - 时间范围缺失：「最近」是 7 天 / 30 天 / 本月？\n' +
            '  - 维度选择不清：「按区域」是按省 sender_province 还是按市 sender_city？\n' +
            '  - 数据范围过大：导出 100 万行确认\n' +
            '使用时：narrative 写"我看到几种可能"，confidence 设 0.5，**不要** refused=true。前端会渲染卡片让用户选。',
          properties: {
            question: { type: 'string', description: '给用户的澄清问题' },
            options: {
              type: 'array',
              description:
                '2-6 个候选答案。**强烈推荐填对象形式**让用户能权衡：\n' +
                '  [{ value: "按日累计", pros: "看趋势直观", cons: "无法看小时颗粒", recommended: true }, ...]\n' +
                '  字段：value(必填) / pros(优点) / cons(缺点) / recommended(是否推荐)。\n' +
                '  也接受简单 string 形式（向后兼容），但当你能写出 pros/cons 时**务必写对象**。',
              items: {
                type: 'object',
                properties: {
                  value: { type: 'string', description: '选项的显示文本（也是用户答的回复内容）' },
                  pros: { type: 'string', description: '一句话讲优点 / 适合场景' },
                  cons: { type: 'string', description: '一句话讲缺点 / 注意点' },
                  recommended: { type: 'boolean', description: '是否推荐（前端高亮 + 加徽章）' },
                },
                required: ['value'],
              },
            },
            reason: { type: 'string', description: '为什么需要澄清（1 句话）' },
          },
          required: ['question'],
          additionalProperties: false,
        },
      },
      required: ['narrative', 'confidence'],
      additionalProperties: false,
    },
  };

  async execute(input: FinalizePayload, _ctx: ToolContext): Promise<FinalizePayload> {
    return {
      sql: input.sql,
      chartType: input.chartType || 'auto',
      narrative: input.narrative,
      confidence: typeof input.confidence === 'number' ? input.confidence : 0.5,
      refused: !!input.refused,
      refuseReason: input.refuseReason,
      insights: Array.isArray(input.insights) ? input.insights : [],
      suggestedFollowUps: Array.isArray(input.suggestedFollowUps)
        ? input.suggestedFollowUps.filter((s) => typeof s === 'string' && s.trim().length > 0)
        : [],
      relatedHints: Array.isArray(input.relatedHints)
        ? input.relatedHints.filter((s) => typeof s === 'string' && s.trim().length > 0)
        : [],
      clarify: input.clarify && input.clarify.question
        ? {
            question: input.clarify.question.trim(),
            options: Array.isArray(input.clarify.options)
              ? input.clarify.options
                  .map((o) => {
                    if (typeof o === 'string') return o.trim() ? o.trim() : null;
                    if (o && typeof o === 'object' && typeof o.value === 'string' && o.value.trim()) {
                      return {
                        value: o.value.trim(),
                        pros: typeof o.pros === 'string' ? o.pros.trim() : undefined,
                        cons: typeof o.cons === 'string' ? o.cons.trim() : undefined,
                        recommended: !!o.recommended,
                      };
                    }
                    return null;
                  })
                  .filter((o): o is NonNullable<typeof o> => !!o)
                  .slice(0, 6)
              : undefined,
            reason: input.clarify.reason?.trim() || undefined,
          }
        : undefined,
    };
  }
}
