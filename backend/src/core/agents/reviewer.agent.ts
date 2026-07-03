import { Injectable, Logger } from '@nestjs/common';
import { LLMGatewayService } from '../../providers/llm/llm-gateway.service';
import { LLMScenario } from '../../providers/llm/types';
import { Skill } from '../../providers/skills/types';
import { FinalizePayload, ToolCallLog } from '../tools/tool.types';

/**
 * Reviewer = Verifier Gate（升级版）
 *
 * 设计灵感：Anatoli Kopadze 的 Loop Engineering 框架。
 *   "No gate means the agent grades its own homework, and the model that
 *    did the work is far too generous a grader."
 *
 * 与之前版本的核心差异：
 *   - 不止给 confidence，要给**可行动反馈**（feedback）— Planner 能据此修改 SQL/narrative
 *   - 不止「应不应该拒答」，要决定「**应不应该返工**」（shouldRetry）
 *   - 5 维度 rubric 评分（0-10），每维度独立 → 失败原因可定位
 *
 * 拒答（refuse） vs 返工（retry）：
 *   - refuse：连续返工后仍不达标 → 告诉用户"无法可信回答"
 *   - retry：本轮不达标但有救 → Planner 重做（注入 feedback 到 messages）
 */

export interface ReviewInput {
  question: string;
  skill: Skill;
  trace: ToolCallLog[];
  proposed: FinalizePayload;
  sqlResult?: {
    rowCount: number;
    columns: { name: string; type: string }[];
    rows: Record<string, any>[];
  };
  /** 已经尝试 verify 多少次（用于"最后一次不让返工"决策）*/
  attemptIndex?: number;
  maxAttempts?: number;
}

/** 5 维度评分（0-10） */
export interface ReviewDimensions {
  /** 1. narrative 是否真的回答了问题 */
  answersQuestion: number;
  /** 2. SQL 结果 ↔ narrative 数字一致 */
  sqlConsistency: number;
  /** 3. 多表场景是否做了 JOIN（单表此项 10 分） */
  joinCompleteness: number;
  /** 4. 关键数字精准（非"约""大概"），且在 SQL 结果中能找到 */
  numericalPrecision: number;
  /** 5. 没引用不存在的表/列/数据（幻觉检测） */
  noHallucination: number;
}

export interface ReviewOutput {
  /** 0..1 的总置信度（dimensions 加权 / 10）*/
  confidence: number;
  /** 5 维度细分 */
  dimensions: ReviewDimensions;
  /** Planner 应该返工 — true 时 Planner 内部继续 ReAct */
  shouldRetry: boolean;
  /** 应该拒答 — 仅最后一轮 retry 仍不达标时为 true */
  shouldRefuse: boolean;
  /** 关键问题列表（给用户/日志看的）*/
  concerns: string[];
  /** 给 Planner 的**可行动**反馈（具体说哪里改、怎么改）*/
  feedback: string;
  /** 整体评价 */
  summary: string;
}

/** 任何维度 < RETRY_THRESHOLD → 触发返工 */
const RETRY_THRESHOLD = 7;
/** 总分 < REFUSE_THRESHOLD 且已耗尽 retry → 拒答 */
const REFUSE_OVERALL_THRESHOLD = 5;

const REVIEWER_SYSTEM_PROMPT = `你是数据分析的**严苛验收员（Verifier）**。

你的任务：审查另一个 Agent 给出的 finalize 方案，按 **5 个维度** 各打 0-10 分，并决定是否要求返工。

## 评分维度（每项 0-10）

### 1. answersQuestion（语义匹配）
narrative 是否真的回答了用户问题？
- 10：直接命中
- 5：答了相关内容但没正面回答
- 0：答非所问 / 回避

### 2. sqlConsistency（SQL 结果 ↔ narrative 数字一致）
narrative 中的关键数字必须能从 sqlResult 中找到。
- 10：所有数字精确对应
- 5：数字略有偏差或四舍五入合理
- 0：编数 / 与结果完全不符

### 3. joinCompleteness（多表 JOIN 完整性）
若问题涉及多表（如"客户姓名 + 订单数"），SQL 必须 JOIN。
- 10：JOIN 正确 / 单表场景天然满分
- 5：JOIN 了但缺关键字段
- 0：应该 JOIN 但没 JOIN，导致信息缺失

### 4. numericalPrecision（数字精确度）
关键回答数字应明确（非"约""大概""左右"），且能在 SQL 结果中验证。
- 10：精确数字，可验证
- 5：明确但单位/精度模糊
- 0：含糊其辞 / 无具体数

### 5. noHallucination（无幻觉）
narrative 不应引用不存在的表名/列名，不应编造结果之外的事实。
- 10：完全基于真实数据
- 5：有小幅推断（合理）
- 0：明显幻觉（如编造列名、虚构数据）

## 决策规则

**shouldRetry = true** 当：任意维度 < ${RETRY_THRESHOLD}，且仍有 retry 机会（attemptIndex < maxAttempts）
**shouldRefuse = true** 当：总分 < ${REFUSE_OVERALL_THRESHOLD} 且已无 retry 机会

## feedback 字段要求（关键！）

如果 shouldRetry=true，feedback 必须**具体可行动**，告诉 Planner 怎么改：
- 不要写："SQL 有问题"
- 要写："SQL 漏了 JOIN customers 表，无法拿到 city 字段。请补 JOIN customers c ON o.cust_id = c.cust_id 后重写"

如果 narrative 数字错误：feedback 应明确"narrative 写 X，但 SQL 结果实际是 Y"。

## ⚠️ 例外路径
- 拒答路径（proposed.refused=true）：跳过审查
- cite_industry_benchmark 工具：知识引用型回答，不算"没 SQL"
- multidim_breakdown / stats_describe / decompose_by_dimensions 等：内部跑了真 SQL，视同 run_sql

## 输出（严格 JSON，不要 markdown 包裹）
{
  "dimensions": {
    "answersQuestion": 0-10,
    "sqlConsistency": 0-10,
    "joinCompleteness": 0-10,
    "numericalPrecision": 0-10,
    "noHallucination": 0-10
  },
  "concerns": ["具体问题 1"],
  "feedback": "给 Planner 的可行动指令（仅 shouldRetry 时必填）",
  "summary": "一句话总评"
}
`;

@Injectable()
export class ReviewerAgent {
  private readonly logger = new Logger(ReviewerAgent.name);

  constructor(private readonly llm: LLMGatewayService) {}

  async review(input: ReviewInput): Promise<ReviewOutput> {
    // 拒答路径不审查
    if (input.proposed.refused) {
      return {
        confidence: input.proposed.confidence,
        dimensions: this.fullScore(),
        shouldRetry: false,
        shouldRefuse: true,
        concerns: [],
        feedback: '',
        summary: '本次为拒答路径，跳过审查。',
      };
    }

    try {
      const resp = await this.llm.call(
        [
          { role: 'system', content: REVIEWER_SYSTEM_PROMPT },
          { role: 'user', content: this.buildPrompt(input) },
        ],
        { scenario: LLMScenario.DEFAULT, jsonMode: true, temperature: 0.1 },
      );
      return this.parseResponse(resp.content, input);
    } catch (err) {
      this.logger.warn(`Reviewer LLM failed: ${(err as Error).message}; bypassing`);
      // Reviewer 自身故障不阻断主流程：放过 + 标记
      return {
        confidence: input.proposed.confidence,
        dimensions: this.fullScore(),
        shouldRetry: false,
        shouldRefuse: false,
        concerns: [`Reviewer 调用失败：${(err as Error).message}`],
        feedback: '',
        summary: 'Reviewer 暂时不可用，置信度沿用 Planner。',
      };
    }
  }

  private fullScore(): ReviewDimensions {
    return {
      answersQuestion: 10,
      sqlConsistency: 10,
      joinCompleteness: 10,
      numericalPrecision: 10,
      noHallucination: 10,
    };
  }

  private buildPrompt(input: ReviewInput): string {
    const attempt = input.attemptIndex ?? 0;
    const max = input.maxAttempts ?? 2;
    const tracePreview = input.trace
      .map(
        (t) =>
          `[s${t.step}] ${t.name}(${JSON.stringify(t.input).substring(0, 150)}) → ${JSON.stringify(t.output).substring(0, 200)}`,
      )
      .join('\n');
    const sqlPreview = input.sqlResult
      ? `列：${input.sqlResult.columns.map((c) => c.name).join(', ')}
共 ${input.sqlResult.rowCount} 行
前 5 行：${JSON.stringify(input.sqlResult.rows.slice(0, 5))}`
      : '（无 SQL 结果）';

    return `# 待审查的方案

## 用户问题
${input.question}

## Skill
${input.skill.meta.name} v${input.skill.meta.version}

## Planner 最终 SQL
\`\`\`sql
${input.proposed.sql || '(无)'}
\`\`\`

## Planner narrative
${input.proposed.narrative}

## Planner 自评 confidence
${input.proposed.confidence}

## SQL 执行结果
${sqlPreview}

## Trace
${tracePreview}

## 本次验收信息
- 当前 attempt：${attempt + 1} / ${max + 1}（${attempt >= max ? '⚠️ 已无返工机会' : '可以要求返工'}）

请按系统提示输出严格 JSON。`;
  }

  private parseResponse(content: string, input: ReviewInput): ReviewOutput {
    const fallback: ReviewOutput = {
      confidence: input.proposed.confidence,
      dimensions: this.fullScore(),
      shouldRetry: false,
      shouldRefuse: false,
      concerns: ['Reviewer 输出解析失败'],
      feedback: '',
      summary: 'Reviewer 输出无法解析，沿用 Planner 置信度。',
    };

    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      this.logger.warn('Reviewer returned non-JSON');
      return fallback;
    }

    let obj: any;
    try {
      obj = JSON.parse(jsonMatch[0]);
    } catch (err) {
      this.logger.warn(`Failed to parse reviewer JSON: ${(err as Error).message}`);
      return fallback;
    }

    const dims = this.coerceDimensions(obj.dimensions);
    const confidence = this.dimensionsToConfidence(dims);
    const attemptIndex = input.attemptIndex ?? 0;
    const maxAttempts = input.maxAttempts ?? 2;
    const hasRetryQuota = attemptIndex < maxAttempts;
    const anyLow = Object.values(dims).some((v) => v < RETRY_THRESHOLD);
    const overallLow = confidence * 10 < REFUSE_OVERALL_THRESHOLD;

    const shouldRetry = anyLow && hasRetryQuota;
    const shouldRefuse = !shouldRetry && overallLow;

    return {
      confidence,
      dimensions: dims,
      shouldRetry,
      shouldRefuse,
      concerns: Array.isArray(obj.concerns) ? obj.concerns.map(String).filter(Boolean) : [],
      feedback: typeof obj.feedback === 'string' ? obj.feedback : '',
      summary: typeof obj.summary === 'string' ? obj.summary : '',
    };
  }

  /** 把任意输入安全转成 ReviewDimensions（缺失字段补 10 — 默认通过） */
  private coerceDimensions(raw: any): ReviewDimensions {
    const clamp = (x: any) =>
      Math.max(0, Math.min(10, Number.isFinite(Number(x)) ? Number(x) : 10));
    return {
      answersQuestion: clamp(raw?.answersQuestion),
      sqlConsistency: clamp(raw?.sqlConsistency),
      joinCompleteness: clamp(raw?.joinCompleteness),
      numericalPrecision: clamp(raw?.numericalPrecision),
      noHallucination: clamp(raw?.noHallucination),
    };
  }

  /** 5 维度 → 总置信度（最低分权重最大，惩罚短板）*/
  private dimensionsToConfidence(d: ReviewDimensions): number {
    const values = Object.values(d);
    const min = Math.min(...values);
    const avg = values.reduce((a, b) => a + b, 0) / values.length;
    // 50% min + 50% avg，让短板拉低总分
    return Math.max(0, Math.min(1, (0.5 * min + 0.5 * avg) / 10));
  }
}
