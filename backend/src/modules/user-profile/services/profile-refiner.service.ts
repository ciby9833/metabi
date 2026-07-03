import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Conversation, Message, MessageRole } from '../../../database/entities';
import { LLMGatewayService } from '../../../providers/llm/llm-gateway.service';
import { LLMScenario } from '../../../providers/llm/types';
import { UserProfileService } from './profile.service';
import { ContentMemory } from '../../../database/entities';

const REFINE_TRIGGER_EVERY_N_CONVS = 5;
const REFINE_LOOKBACK_CONVS = 20;

const REFINER_SYSTEM_PROMPT = `你是一个**用户画像分析师**，根据用户最近的对话历史，提炼出他/她的「ContentMemory」。

## 你要做的
读完最近的对话样本，输出一个 JSON 描述这个用户**关注什么**、**熟悉什么术语**、**问问题的模式**。

## ⚠️ 重要原则（避免 echo chamber 陷阱）
1. **只挖共性，不当成铁规** — 用户问过 X 不代表以后都得围绕 X
2. **术语熟悉 ≠ 内容偏好** — 用户熟悉 "DSO" 只意味着不必解释术语，不该每次都谈 DSO
3. **oneLinerSummary 不要贴标签** — 写"财务部资深分析师"OK；写"只关心应收"❌（限制太死）
4. **interestTopics 最多 5 个** — 多了反而无信号
5. **如果对话量少（< 3 个）→ 返回空 JSON {}** — 没有信号就别瞎学

## 输出 JSON 严格按此结构（不要 markdown 包裹）
{
  "oneLinerSummary": "一句话画像，如「财务团队成员，常做 5-10 客户级别的应收分析」",
  "interestTopics": ["关注主题 1", "关注主题 2"],
  "knownTerms": ["术语 1", "术语 2"],
  "questionPatterns": ["问法模式 1"],
  "defaultDateRange": "如「最近 30 天」/ 留空"
}

任一字段无信号可省略。不要编造。
`;

/**
 * ProfileRefinerService — 自动学习用户的 ContentMemory
 *
 * 触发：每 REFINE_TRIGGER_EVERY_N_CONVS 个新对话后异步跑（fire-and-forget）
 * 输入：最近 REFINE_LOOKBACK_CONVS 个对话的 user message
 * 输出：覆盖式 ContentMemory（Refiner 自己做"保留 vs 更新"的合并）
 *
 * 不阻塞 chat，失败不影响主流程。
 */
@Injectable()
export class ProfileRefinerService {
  private readonly logger = new Logger(ProfileRefinerService.name);
  /** 防止并发：同一 user 同时只跑一次 */
  private readonly inflight = new Set<string>();

  constructor(
    @InjectRepository(Conversation)
    private readonly convRepo: Repository<Conversation>,
    @InjectRepository(Message)
    private readonly msgRepo: Repository<Message>,
    private readonly llm: LLMGatewayService,
    private readonly profileService: UserProfileService,
  ) {}

  /**
   * 检查是否该跑 + 异步触发。
   * 调用方应在 turn 完成后调用：refineIfDueAsync(userId)（不 await）
   */
  refineIfDueAsync(userId: string): void {
    void this.refineIfDue(userId).catch((err) =>
      this.logger.warn(`Refine failed for ${userId}: ${(err as Error).message}`),
    );
  }

  private async refineIfDue(userId: string): Promise<void> {
    if (this.inflight.has(userId)) return;

    const profile = await this.profileService.getOrEmpty(userId);
    const totalConvs = await this.convRepo.count({ where: { userId } });

    // 是否到点
    const delta = totalConvs - profile.refinedThroughConvCount;
    if (delta < REFINE_TRIGGER_EVERY_N_CONVS) return;

    this.inflight.add(userId);
    try {
      await this.runRefine(userId, totalConvs);
    } finally {
      this.inflight.delete(userId);
    }
  }

  /** 用户手动触发（Settings 页"立刻分析我"按钮）*/
  async refineNow(userId: string): Promise<void> {
    if (this.inflight.has(userId)) {
      throw new Error('Refine 正在进行中，请稍候');
    }
    const totalConvs = await this.convRepo.count({ where: { userId } });
    this.inflight.add(userId);
    try {
      await this.runRefine(userId, totalConvs);
    } finally {
      this.inflight.delete(userId);
    }
  }

  private async runRefine(userId: string, totalConvs: number): Promise<void> {
    // 拉最近 N 个对话的第一条 user message 作为样本
    const convs = await this.convRepo.find({
      where: { userId },
      order: { updatedAt: 'DESC' },
      take: REFINE_LOOKBACK_CONVS,
    });
    if (convs.length < 3) {
      this.logger.debug(`Refine skipped: only ${convs.length} convs (< 3)`);
      return;
    }

    // 每个对话拿一条 user message 作为样本（避免 token 爆）
    const samples: string[] = [];
    for (const c of convs) {
      const msgs = await this.msgRepo.find({
        where: { conversationId: c.id, role: MessageRole.USER },
        order: { createdAt: 'ASC' },
        take: 1,
      });
      if (msgs[0]?.content) {
        samples.push(`- ${msgs[0].content.substring(0, 200)}`);
      }
    }
    if (samples.length === 0) return;

    const userPrompt = `## 最近 ${samples.length} 次对话用户首问样本

${samples.join('\n')}

---

请输出 JSON 形式的 ContentMemory。`;

    let parsed: ContentMemory = {};
    try {
      const resp = await this.llm.call(
        [
          { role: 'system', content: REFINER_SYSTEM_PROMPT },
          { role: 'user', content: userPrompt },
        ],
        { scenario: LLMScenario.DEFAULT, jsonMode: true, temperature: 0.2 },
      );
      parsed = this.parseResponse(resp.content);
    } catch (err) {
      this.logger.warn(`Refiner LLM failed: ${(err as Error).message}`);
      return;
    }

    await this.profileService.saveRefined(userId, parsed, totalConvs);
    this.logger.log(
      `Refined profile for user=${userId}: convs=${totalConvs}, topics=${
        parsed.interestTopics?.length || 0
      }`,
    );
  }

  private parseResponse(content: string): ContentMemory {
    const match = content.match(/\{[\s\S]*\}/);
    if (!match) return {};
    try {
      const obj = JSON.parse(match[0]);
      const safe: ContentMemory = {};
      if (typeof obj.oneLinerSummary === 'string') safe.oneLinerSummary = obj.oneLinerSummary;
      if (Array.isArray(obj.interestTopics))
        safe.interestTopics = obj.interestTopics.map(String).slice(0, 5);
      if (Array.isArray(obj.knownTerms))
        safe.knownTerms = obj.knownTerms.map(String).slice(0, 20);
      if (Array.isArray(obj.questionPatterns))
        safe.questionPatterns = obj.questionPatterns.map(String).slice(0, 5);
      if (typeof obj.defaultDateRange === 'string')
        safe.defaultDateRange = obj.defaultDateRange;
      return safe;
    } catch {
      return {};
    }
  }
}
