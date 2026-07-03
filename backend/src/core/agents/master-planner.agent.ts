import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { LLMGatewayService } from '../../providers/llm/llm-gateway.service';
import {
  AssistantToolCallMessage,
  ConversationMessage,
  LLMScenario,
  ToolCallRequest,
  ToolDeclaration,
  ToolResultMessage,
} from '../../providers/llm/types';
import { SkillLoaderService } from '../../providers/skills/skill-loader.service';
import { SubAgentCall } from '../../database/entities';
import { FinalizePayload, JsonSchema, ToolCallLog } from '../tools/tool.types';
import { PlannerAgent, PlannerOutput, drainPlanner } from './planner.agent';

export interface MasterInput {
  question: string;
  datasourceId: string;
  conversationId?: string;
  userId?: string;
  /**
   * 本轮附件的 preview 文本（table/pdf/text） —— Master 必须看到才能正确判定
   * "用户在讨论附件" vs "用户要查库分析"，避免无视附件反问"你说的什么"
   */
  attachmentContext?: string;
  /**
   * 本轮用户上传的 image 附件 —— master 不看，透传给子 planner
   * (image 是数据分析用的，Master 只做意图理解 + 派子 agent；vision 归子 planner)
   */
  currentAttachments?: import('../../providers/llm/types').ChatAttachmentInline[];
}

export interface MasterStep {
  step: number;
  /** master step 自身：run_skill_agent / list_available_skills / finalize_master / recall_subagent_result */
  name: string;
  input: any;
  output: any;
  durationMs: number;
  /** 如果是 run_skill_agent，记录子 agent 的归档 ID（供前端展开树）*/
  subAgentCallId?: string;
  /** 子 agent 内部步骤（仅 run_skill_agent 时填）*/
  subSteps?: ToolCallLog[];
}

export interface MasterOutput {
  finalize: FinalizePayload;
  trace: MasterStep[];
  totalTokens: number;
  totalLatencyMs: number;
  /** 把"最后一次产生数据的子 agent 结果"暴露给 orchestrator 当成主结果展示 */
  sqlResult?: PlannerOutput['sqlResult'];
  /** 主 agent 自己的"chosen skill" — 用最后一个子 agent 的 skill 名当代表 */
  skillName: string;
  rawMessages: ConversationMessage[];
  /** 派遣的所有子任务（供后续轮召回 / 持久化）*/
  subAgentCalls: SubAgentCall[];
}

/**
 * Master 流式事件 — 由 runStream() 产出。
 *
 * Master 暂停点：finalize_master 含 clarify 时 yield + 等 next(answer)。
 * Sub-agent 内部事件**不展开**（避免事件爆炸）— 仅 yield dispatch / result 概览，
 * 详细 sub-agent trace 可由前端通过 subAgentCallId 拉取。
 */
export type MasterEvent =
  | { type: 'master_start' }
  | { type: 'master_llm_call_start'; step: number }
  | { type: 'master_llm_call_end'; step: number; tokens?: number }
  | { type: 'sub_agent_dispatch'; step: number; skillName: string; subQuestion: string; reason?: string }
  | {
      type: 'sub_agent_result';
      step: number;
      subAgentCallId: string;
      skillName: string;
      narrative: string;
      rowCount: number;
      durationMs: number;
      refused: boolean;
    }
  | { type: 'master_tool_executing'; step: number; name: string; args: any }
  | { type: 'master_tool_result'; step: number; name: string; output: any; durationMs: number }
  | { type: 'clarify_request'; clarify: import('../tools/tool.types').ClarifyRequest }
  | { type: 'clarify_resolved'; answer: string }
  | { type: 'finalize'; finalize: FinalizePayload; sqlResult?: PlannerOutput['sqlResult'] }
  | { type: 'error'; message: string };

const MAX_MASTER_STEPS = 8;
const MAX_SUBAGENTS_PER_TURN = 4;
/** 给子 agent 看的"压缩历史子任务结果"，避免主 agent 反复传 */
const COMPACT_ROW_LIMIT = 5;

const MASTER_SYSTEM_PROMPT = `你是 ChatBI 的**主调度官**（Master Agent）—— 是**对话伙伴**，不是 SQL 派单员。

## 心智模型（最重要）

Claude 那样的对话：**理解 → (需要时) 澄清 → (需要时) 派子 agent → 汇总**。
**不是每问必派子 agent**。

**判断**：
- 用户在**讨论 / 澄清 / 问概念 / 看附件**（"这是什么"、"我该看啥"、"帮我想想"）
  → **直接 finalize_master** 用你自己的知识对话回答，或反 clarify 反问细节。**不要**派子 agent 去查库
- 用户**明确要数据**（"按大区统计订单"、"最近 7 天趋势"、"Top 10 客户"）
  → 派子 agent 去做

**附件优先**：如果 attachment context 里有附件 preview，那是本轮主要材料。
- 用户问"这份表里有啥" → 你直接答（附件内容你看得到），不派子 agent
- 用户要跟库交叉（"这些客户在库里发货多少"）→ 派子 agent，subQuestion 里带上附件的关键值

## 你的角色
理解用户问题，判断"该讨论 / 该反问 / 该派子 agent"，最后 finalize_master 收尾。

## 你能用的工具
1. \`list_available_skills\` — 看当前数据源下都有哪些 Skill（业务领域专家）
2. \`run_skill_agent({ skillName, subQuestion, reason })\` — 派遣一个 Skill 子 agent 去回答子问题
   - 子 agent 有完整的数据工具（list_tables / run_sql / multidim_breakdown / decompose / 等）
   - 子 agent 返回给你的是**压缩结果**：narrative + final SQL + 前 5 行数据
   - 想看完整数据：调 \`recall_subagent_result\`
3. \`recall_subagent_result({ subAgentCallId })\` — 拉回某个子任务的完整结果（含全部数据行）
4. \`finalize_master({ narrative, useSubAgentDataAs }, ...）\` — 汇总收尾

## 工作流程
1. 看用户问题
2. 调 \`list_available_skills\` 看候选 Skill（已经在 system context 里给你了，多数情况下不需要再调）
3. **如果问题落在单个 Skill 内** → 调 1 次 \`run_skill_agent\` → 直接 \`finalize_master\` 引用子结果（最常见）
4. **如果跨多个 Skill** → 多次 \`run_skill_agent\`，每次一个子任务，最后汇总
5. **如果子任务结果有矛盾或不充分** → 再派一次子 agent 补充
6. 永远以 \`finalize_master\` 结束（不要忘）

## 重要原则
- ❌ 不要自己探索表 / 写 SQL — 那是子 agent 的事
- ✅ 子任务问题要**完整、具体、自包含**（子 agent 看不到你的 context，只看到 subQuestion）
  - 反例：subQuestion="按你刚才说的拆一下" ❌
  - 正例：subQuestion="按 origin_city 维度统计 6 月份各城市运单数（count distinct waybill_no），TopN 取前 20" ✅
- ✅ 子任务**互相独立**，能并行做（虽然现在是顺序执行）
- ✅ 不要拆得太细 — 能让一个子 agent 一次性算完就别拆 2 个
- ✅ 用户问"为什么"等归因问题：派给最相关的 skill，它会用 decompose_by_dimensions 工具
- ✅ 最终 \`finalize_master\` 的 narrative 要把多个子结果**揉合成一个连贯的回答**，不是简单拼接

## 关于 finalize_master 的 useSubAgentDataAs
- 前端会展示一个表格 + 图表，需要"主数据"。指明用哪个子任务的数据：
  - 不填 → 用最后一个子任务的数据
  - 填子任务 ID → 用指定的
- narrative 要引用具体数字，不要泛泛而谈

## 关于澄清
如果你判断**用户问题本身就有歧义**（如"销量"含义不明），可以**不派遣子 agent**，直接 \`finalize_master\` 时填 \`clarify\` 字段问用户。这比让多个子 agent 各自瞎猜更高效。
`;

@Injectable()
export class MasterPlannerAgent {
  private readonly logger = new Logger(MasterPlannerAgent.name);

  constructor(
    private readonly llm: LLMGatewayService,
    private readonly skillLoader: SkillLoaderService,
    private readonly planner: PlannerAgent,
    @InjectRepository(SubAgentCall)
    private readonly subAgentRepo: Repository<SubAgentCall>,
  ) {}

  /**
   * Master 主入口 — async generator。
   *
   * 设计：
   *   - 每个 LLM step / sub-agent dispatch / tool 结果都 yield 事件
   *   - finalize_master 含 clarify 时 yield ClarifyRequestEvent 等外部 next(answer)
   *   - Sub-agent 内部事件不展开（避免事件爆炸） — 仅 yield dispatch/result 概览
   */
  async *runStream(
    input: MasterInput,
  ): AsyncGenerator<MasterEvent, MasterOutput, string | undefined> {
    const startedAt = Date.now();
    const trace: MasterStep[] = [];
    const subAgentCalls: SubAgentCall[] = [];
    let totalTokens = 0;
    let finalize: FinalizePayload | undefined;
    let chosenSubAgentForData: SubAgentCall | null = null;
    let subAgentCount = 0;

    yield { type: 'master_start' };

    const skillsBlock = this.buildSkillsListContext();
    // 附件顶部注入 —— Master 需要看到用户传了什么，才能正确判定"讨论附件"vs"查库分析"
    const attachmentHeader = input.attachmentContext
      ? [{ role: 'system' as const, content: input.attachmentContext }]
      : [];
    // 用户消息也带上 attachments（vision block），跟 planner 保持一致
    const userMessage: ConversationMessage = {
      role: 'user',
      content: `用户问题：${input.question}`,
      ...(input.currentAttachments && input.currentAttachments.length > 0
        ? { attachments: input.currentAttachments }
        : {}),
    };
    const messages: ConversationMessage[] = [
      ...attachmentHeader,
      { role: 'system', content: MASTER_SYSTEM_PROMPT },
      { role: 'system', content: skillsBlock },
      userMessage,
    ];

    const toolDeclarations = this.buildToolDeclarations();

    masterLoop: for (let step = 1; step <= MAX_MASTER_STEPS; step++) {
      yield { type: 'master_llm_call_start', step };
      const resp = await this.llm.callWithTools(messages, toolDeclarations, {
        scenario: LLMScenario.SQL_GENERATION,
        temperature: 0.1,
      });
      const stepTokens = resp.usage?.totalTokens || 0;
      totalTokens += stepTokens;
      yield { type: 'master_llm_call_end', step, tokens: stepTokens };

      if (resp.type === 'message') {
        // Master 用文本回了 → 强行拒答
        finalize = {
          narrative: resp.content || '主调度官未给出最终答案',
          confidence: 0.2,
          refused: true,
          refuseReason: '主 agent 未调用 finalize_master 就直接回了文本。',
        };
        break;
      }

      const toolCalls = resp.toolCalls || [];
      messages.push({
        role: 'assistant',
        toolCalls,
        content: resp.content,
      } as AssistantToolCallMessage);

      // 顺序执行所有 tool calls
      for (const tc of toolCalls) {
        const t0 = Date.now();
        let output: any;
        const masterStep: MasterStep = {
          step,
          name: tc.name,
          input: tc.arguments,
          output: null,
          durationMs: 0,
        };

        if (tc.name === 'finalize_master') {
          const candidateFinalize = this.parseFinalizeMaster(tc.arguments);

          // ===== 关键：clarify 暂停 + 续推 =====
          if (candidateFinalize.clarify?.question) {
            const answerFromUser = yield {
              type: 'clarify_request',
              clarify: candidateFinalize.clarify,
            };
            if (typeof answerFromUser === 'string' && answerFromUser.trim()) {
              const mergedHint =
                `（你上一轮 finalize_master 提出了 clarify："${candidateFinalize.clarify.question}"；` +
                `用户的回答是："${answerFromUser.trim()}"。请基于此**立即**派遣子 agent 完成查询并给出数据，不要再 clarify。）`;
              messages.push({ role: 'user', content: mergedHint });
              yield { type: 'clarify_resolved', answer: answerFromUser.trim() };
              continue masterLoop;
            }
            // 没收到答案 → fallback：当作普通 finalize
          }

          finalize = candidateFinalize;
          // 如果指定了 useSubAgentDataAs → 找对应子任务
          const useId = (tc.arguments as any)?.useSubAgentDataAs;
          if (useId) {
            const found = subAgentCalls.find((s) => s.id === useId);
            if (found) chosenSubAgentForData = found;
          }
          output = { ok: true, accepted: true };
          masterStep.output = output;
          masterStep.durationMs = Date.now() - t0;
          trace.push(masterStep);
          messages.push(this.toolResultMessage(tc, output));
          break; // 退出 toolCalls 循环
        } else if (tc.name === 'list_available_skills') {
          yield { type: 'master_tool_executing', step, name: tc.name, args: tc.arguments };
          output = { skills: this.listSkillSummaries() };
        } else if (tc.name === 'run_skill_agent') {
          if (subAgentCount >= MAX_SUBAGENTS_PER_TURN) {
            output = {
              ok: false,
              error: `已达本轮 sub-agent 调用上限 (${MAX_SUBAGENTS_PER_TURN})，请用 finalize_master 收尾。`,
            };
          } else {
            const args = tc.arguments as {
              skillName: string;
              subQuestion: string;
              reason?: string;
            };
            yield {
              type: 'sub_agent_dispatch',
              step,
              skillName: args.skillName,
              subQuestion: args.subQuestion,
              reason: args.reason,
            };
            const call = await this.runSubAgent(
              input,
              args.skillName,
              args.subQuestion,
              args.reason,
              step,
            );
            subAgentCount++;
            subAgentCalls.push(call);
            yield {
              type: 'sub_agent_result',
              step,
              subAgentCallId: call.id,
              skillName: call.skillName,
              narrative: (call.narrative || '').substring(0, 500),
              rowCount: call.resultRowCount || 0,
              durationMs: call.durationMs || 0,
              refused: call.refused,
            };
            output = {
              ok: !call.refused,
              subAgentCallId: call.id,
              skillName: call.skillName,
              compact: call.compactSummary, // narrative + sql + 前 5 行
              totalTokens: call.totalTokens,
              durationMs: call.durationMs,
            };
            masterStep.subAgentCallId = call.id;
            masterStep.subSteps = (call.rawMessages as any)?._trace; // 仅引用，不展开
          }
        } else if (tc.name === 'recall_subagent_result') {
          yield { type: 'master_tool_executing', step, name: tc.name, args: tc.arguments };
          const args = tc.arguments as { subAgentCallId: string };
          const c = subAgentCalls.find((s) => s.id === args.subAgentCallId);
          output = c
            ? {
                ok: true,
                narrative: c.narrative,
                sql: c.finalSql,
                columns: c.resultColumns,
                rows: c.resultRows, // 完整数据
                rowCount: c.resultRowCount,
              }
            : { ok: false, error: `subAgentCallId ${args.subAgentCallId} 不存在` };
        } else {
          output = { ok: false, error: `主 agent 不支持工具 ${tc.name}` };
        }

        masterStep.output = output;
        masterStep.durationMs = Date.now() - t0;
        trace.push(masterStep);
        if (tc.name !== 'run_skill_agent') {
          // run_skill_agent 已经在上面专门 yield 了 sub_agent_result
          yield {
            type: 'master_tool_result',
            step,
            name: tc.name,
            output,
            durationMs: masterStep.durationMs,
          };
        }
        messages.push(this.toolResultMessage(tc, output));
      }

      if (finalize) break;
    }

    if (!finalize) {
      finalize = {
        narrative: '主调度官超过最大步数仍未收尾',
        confidence: 0.2,
        refused: true,
        refuseReason: `Master agent 达 MAX_MASTER_STEPS=${MAX_MASTER_STEPS} 仍未 finalize`,
      };
    }

    // 选择"主数据"
    if (!chosenSubAgentForData && subAgentCalls.length > 0) {
      // 找最后一个有数据的子任务
      for (let i = subAgentCalls.length - 1; i >= 0; i--) {
        if (subAgentCalls[i].resultColumns?.length) {
          chosenSubAgentForData = subAgentCalls[i];
          break;
        }
      }
    }

    const sqlResult = chosenSubAgentForData
      ? {
          columns: chosenSubAgentForData.resultColumns || [],
          rows: chosenSubAgentForData.resultRows || [],
          rowCount: chosenSubAgentForData.resultRowCount || 0,
          truncated: false,
          generatedSql: chosenSubAgentForData.finalSql || undefined,
        }
      : undefined;

    // === 关键：从主数据 sub-agent 继承 5 大功能字段 ===
    // master LLM 自己很少会再填一遍 insights/followups/related/lineage（费 token 且容易丢），
    // 改成：master finalize 没填的字段 → 自动用主数据 sub-agent 的对应字段
    if (chosenSubAgentForData?.compactSummary) {
      const subSummary = chosenSubAgentForData.compactSummary as any;
      if ((!finalize.insights || finalize.insights.length === 0) && subSummary.insights?.length) {
        finalize.insights = subSummary.insights;
      }
      if ((!finalize.suggestedFollowUps || finalize.suggestedFollowUps.length === 0) && subSummary.suggestedFollowUps?.length) {
        finalize.suggestedFollowUps = subSummary.suggestedFollowUps;
      }
      if ((!finalize.relatedHints || finalize.relatedHints.length === 0) && subSummary.relatedHints?.length) {
        finalize.relatedHints = subSummary.relatedHints;
      }
    }

    // skillName：所有子 agent 用过的 skill 用 + 拼，或单个直接给名
    const skillName = subAgentCalls.length === 0
      ? 'master'
      : subAgentCalls.length === 1
        ? subAgentCalls[0].skillName
        : `master(${[...new Set(subAgentCalls.map((s) => s.skillName))].join(',')})`;

    yield { type: 'finalize', finalize, sqlResult };

    return {
      finalize,
      trace,
      totalTokens,
      totalLatencyMs: Date.now() - startedAt,
      sqlResult,
      skillName,
      rawMessages: messages,
      subAgentCalls,
    };
  }

  // ============== sub-agent 调用包装 ==============

  private async runSubAgent(
    masterInput: MasterInput,
    skillName: string,
    subQuestion: string,
    reason: string | undefined,
    masterStep: number,
  ): Promise<SubAgentCall> {
    const t0 = Date.now();
    let plannerOutput: PlannerOutput;
    try {
      // sub-agent 不需要 SSE 流式，直接 drain generator 到完成
      plannerOutput = await drainPlanner(
        this.planner.runStream({
          question: subQuestion,
          datasourceId: masterInput.datasourceId,
          conversationId: masterInput.conversationId,
          userId: masterInput.userId,
          forcedSkillName: skillName,
          isSubAgent: true,
          // 附件透传给子 planner —— master 不看图，子 planner 才用 vision
          currentAttachments: masterInput.currentAttachments,
        }),
      );
    } catch (err) {
      const fail = this.subAgentRepo.create({
        conversationId: masterInput.conversationId || '',
        masterStep,
        skillName,
        subQuestion,
        refused: true,
        narrative: `子 agent 执行失败: ${(err as Error).message}`,
        durationMs: Date.now() - t0,
      });
      return this.subAgentRepo.save(fail);
    }

    // 压缩给 master 看的结果：narrative + SQL + 前 5 行
    // + 顺便存 sub-agent finalize 的 insights/followups/related/lineage，便于 master 继承
    const compact = {
      narrative: plannerOutput.finalize.narrative,
      sql: plannerOutput.finalize.sql || plannerOutput.sqlResult?.generatedSql,
      rowCount: plannerOutput.sqlResult?.rowCount || 0,
      columns: plannerOutput.sqlResult?.columns,
      firstRows: (plannerOutput.sqlResult?.rows || []).slice(0, COMPACT_ROW_LIMIT),
      confidence: plannerOutput.finalize.confidence,
      refused: plannerOutput.finalize.refused,
      reason,
      // 关键：透传给 master finalize 继承，避免 5 大功能在 master 路径下丢失
      insights: plannerOutput.finalize.insights || [],
      suggestedFollowUps: plannerOutput.finalize.suggestedFollowUps || [],
      relatedHints: plannerOutput.finalize.relatedHints || [],
    };

    const record = this.subAgentRepo.create({
      conversationId: masterInput.conversationId || '',
      masterStep,
      skillName,
      subQuestion,
      rawMessages: plannerOutput.rawMessages as any,
      finalSql:
        plannerOutput.finalize.sql || plannerOutput.sqlResult?.generatedSql || null,
      resultColumns: plannerOutput.sqlResult?.columns || null,
      resultRows: plannerOutput.sqlResult?.rows || null,
      resultRowCount: plannerOutput.sqlResult?.rowCount || null,
      narrative: plannerOutput.finalize.narrative,
      refused: plannerOutput.finalize.refused || false,
      totalTokens: plannerOutput.totalTokens,
      durationMs: Date.now() - t0,
      compactSummary: compact,
    });

    return this.subAgentRepo.save(record);
  }

  // ============== 工具定义 ==============

  private buildToolDeclarations(): ToolDeclaration[] {
    return [
      {
        name: 'list_available_skills',
        description: '查看当前数据源下可用的 Skill（业务领域专家）。返回每个 skill 的 name + description + 触发关键词。',
        parameters: { type: 'object', properties: {} } as JsonSchema,
      },
      {
        name: 'run_skill_agent',
        description: '派遣一个 Skill 子 agent 去处理子任务。子 agent 会拥有数据探索 + SQL 执行 + 归因 + 多维拆解等完整能力。',
        parameters: {
          type: 'object',
          properties: {
            skillName: { type: 'string', description: '子 agent 要用的 skill，必须是 list_available_skills 返回的之一' },
            subQuestion: {
              type: 'string',
              description: '完整、具体、自包含的子问题。子 agent 看不到 master context，只看 subQuestion。',
            },
            reason: { type: 'string', description: '为什么派给这个 skill（给前端展示用）' },
          },
          required: ['skillName', 'subQuestion'],
          additionalProperties: false,
        } as JsonSchema,
      },
      {
        name: 'recall_subagent_result',
        description: '拉回某次子 agent 调用的完整结果（含全部数据行，不是压缩版）。用于：你要看具体某行数据 / 准备汇总时引用具体数字。',
        parameters: {
          type: 'object',
          properties: {
            subAgentCallId: { type: 'string', description: 'run_skill_agent 返回的 ID' },
          },
          required: ['subAgentCallId'],
          additionalProperties: false,
        } as JsonSchema,
      },
      {
        name: 'finalize_master',
        description: '主调度官汇总收尾。把多个子 agent 的结论揉合成一个连贯回答。',
        parameters: {
          type: 'object',
          properties: {
            narrative: {
              type: 'string',
              description:
                '给用户的最终回答（中文）。把多个子任务的结论揉合，不要简单拼接。引用具体数字而非泛泛而谈。',
            },
            confidence: { type: 'number', minimum: 0, maximum: 1 },
            useSubAgentDataAs: {
              type: 'string',
              description: '可选：指定用哪个子任务的数据作为前端表格 / 图表展示。不填则用最后一个有数据的子任务。',
            },
            chartType: {
              type: 'string',
              enum: ['line', 'bar', 'pie', 'table', 'scatter', 'heatmap', 'auto'],
            },
            refused: { type: 'boolean' },
            refuseReason: { type: 'string' },
            insights: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  severity: { type: 'string', enum: ['info', 'warning', 'critical'] },
                  text: { type: 'string' },
                  kind: {
                    type: 'string',
                    enum: ['anomaly', 'concentration', 'data_quality', 'trend', 'business', 'attribution'],
                  },
                },
                required: ['severity', 'text'],
              },
            },
            suggestedFollowUps: { type: 'array', items: { type: 'string' } },
            relatedHints: { type: 'array', items: { type: 'string' } },
            clarify: {
              type: 'object',
              description:
                '如果你判断问题本身有歧义不该派子 agent，直接问用户。' +
                'options 推荐填对象形式 ({ value, pros, cons, recommended }) 让用户能权衡。',
              properties: {
                question: { type: 'string' },
                options: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      value: { type: 'string' },
                      pros: { type: 'string' },
                      cons: { type: 'string' },
                      recommended: { type: 'boolean' },
                    },
                    required: ['value'],
                  },
                },
                reason: { type: 'string' },
              },
              required: ['question'],
            },
          },
          required: ['narrative', 'confidence'],
        } as JsonSchema,
      },
    ];
  }

  private listSkillSummaries() {
    return this.skillLoader.getAll().map((s) => ({
      name: s.meta.name,
      description: s.meta.description,
      match: s.meta.match,
      tables: s.meta.tables,
    }));
  }

  private buildSkillsListContext(): string {
    const skills = this.listSkillSummaries();
    if (skills.length === 0) return '# 当前数据源没有可用 Skill';
    const lines = ['# 当前可用的 Skill 子 agent 列表'];
    for (const s of skills) {
      lines.push(
        `\n- **${s.name}**\n  - 描述：${s.description}\n  - 触发关键词：${s.match || '(无)'}\n  - 涉及表：${(s.tables || []).join(', ') || '(无白名单)'}`,
      );
    }
    lines.push(
      '\n\n大多数问题用 1 个 skill 就够；只在用户问题明显跨多个 Skill 领域时才派多个子 agent。',
    );
    return lines.join('\n');
  }

  private parseFinalizeMaster(args: any): FinalizePayload {
    return {
      sql: undefined, // master 不直接产 SQL，由 orchestrator 用 sqlResult.generatedSql 兜底
      chartType: args?.chartType || 'auto',
      narrative: args?.narrative || '',
      confidence: typeof args?.confidence === 'number' ? args.confidence : 0.5,
      refused: !!args?.refused,
      refuseReason: args?.refuseReason,
      insights: Array.isArray(args?.insights) ? args.insights : [],
      suggestedFollowUps: Array.isArray(args?.suggestedFollowUps) ? args.suggestedFollowUps : [],
      relatedHints: Array.isArray(args?.relatedHints) ? args.relatedHints : [],
      clarify: args?.clarify?.question
        ? {
            question: args.clarify.question,
            options: Array.isArray(args.clarify.options)
              ? args.clarify.options
                  .map((o: any) => {
                    if (typeof o === 'string') return o;
                    if (o && typeof o === 'object' && typeof o.value === 'string') {
                      return {
                        value: o.value,
                        pros: typeof o.pros === 'string' ? o.pros : undefined,
                        cons: typeof o.cons === 'string' ? o.cons : undefined,
                        recommended: !!o.recommended,
                      };
                    }
                    return null;
                  })
                  .filter((o: any) => o)
              : undefined,
            reason: args.clarify.reason,
          }
        : undefined,
    };
  }

  private toolResultMessage(tc: ToolCallRequest, output: any): ToolResultMessage {
    return {
      role: 'tool',
      toolCallId: tc.id,
      toolName: tc.name,
      content: JSON.stringify(output),
    };
  }
}

/**
 * Drain a master generator to completion, optionally consuming each event.
 *
 * 用于非 SSE 路径（HTTP req/resp、单元测试）。SSE 端点直接消费 generator，不用这个。
 */
export async function drainMaster(
  gen: AsyncGenerator<MasterEvent, MasterOutput, string | undefined>,
  onEvent?: (ev: MasterEvent) => void,
): Promise<MasterOutput> {
  while (true) {
    const result = await gen.next();
    if (result.done) return result.value;
    if (onEvent) onEvent(result.value);
  }
}
