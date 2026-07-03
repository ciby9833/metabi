import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { UserProfile, StyleMemory, ContentMemory } from '../../../database/entities';

/**
 * UserProfile CRUD + 注入 prompt 用的拼装 helper。
 *
 * 设计原则（context-align）：
 *   - **soft prior**: 注入 prompt 时强调"仅作上下文，不应改变分析结论"
 *   - **透明**: 任何字段都可被用户在 Settings 查看 + 编辑 + 清空
 */
@Injectable()
export class UserProfileService {
  private readonly logger = new Logger(UserProfileService.name);

  constructor(
    @InjectRepository(UserProfile)
    private readonly repo: Repository<UserProfile>,
  ) {}

  /** 找不到就当作空 profile 返回（不入库） */
  async getOrEmpty(userId: string): Promise<UserProfile> {
    const found = await this.repo.findOne({ where: { userId } });
    if (found) return found;
    return this.repo.create({
      userId,
      styleMemory: {},
      contentMemory: {},
      lastRefinedAt: null,
      refinedThroughConvCount: 0,
    });
  }

  /** 找不到就懒创建并落库 */
  async getOrCreate(userId: string): Promise<UserProfile> {
    let p = await this.repo.findOne({ where: { userId } });
    if (p) return p;
    p = await this.repo.save(
      this.repo.create({
        userId,
        styleMemory: {},
        contentMemory: {},
        lastRefinedAt: null,
        refinedThroughConvCount: 0,
      }),
    );
    return p;
  }

  /**
   * 部分更新（patch 语义 — 只动传入的字段；空对象表示"清空该字段")。
   * 用户在 Settings 编辑时用。
   */
  async patchStyle(userId: string, patch: Partial<StyleMemory>): Promise<UserProfile> {
    const p = await this.getOrCreate(userId);
    p.styleMemory = { ...p.styleMemory, ...patch };
    return this.repo.save(p);
  }

  async patchContent(userId: string, patch: Partial<ContentMemory>): Promise<UserProfile> {
    const p = await this.getOrCreate(userId);
    p.contentMemory = { ...p.contentMemory, ...patch };
    return this.repo.save(p);
  }

  /** 一键 reset — Anti-bias 关键设计：用户感觉被定型时立刻可脱离 */
  async reset(userId: string): Promise<UserProfile> {
    const p = await this.getOrCreate(userId);
    p.styleMemory = {};
    p.contentMemory = {};
    p.lastRefinedAt = null;
    p.refinedThroughConvCount = 0;
    return this.repo.save(p);
  }

  /** Refiner 跑完后写回（覆盖式 — Refiner 已合并历史）*/
  async saveRefined(
    userId: string,
    contentPatch: ContentMemory,
    processedConvCount: number,
  ): Promise<UserProfile> {
    const p = await this.getOrCreate(userId);
    // Refiner 输出已是合并后的全量；不再二次合并
    p.contentMemory = contentPatch;
    p.lastRefinedAt = new Date();
    p.refinedThroughConvCount = processedConvCount;
    return this.repo.save(p);
  }

  // ============ Prompt 拼装（拆成 Style / Content 两段）============

  /**
   * Style 注入 — 语气 / 格式偏好，跟话题无关，永远注入。
   */
  buildStyleInjection(profile: UserProfile): string | null {
    const style = profile.styleMemory || {};
    const styleParts: string[] = [];
    if (style.verbosity === 'concise') styleParts.push('回答**简洁**（重点 + 关键数字，无废话）');
    else if (style.verbosity === 'detailed')
      styleParts.push('回答**详尽**（含统计/对比/解读）');
    if (style.numberFormat === 'kw') styleParts.push('数字默认用"万"单位（如 12.3 万 vs 123000）');
    if (style.preferredLanguage === 'en') styleParts.push('回答用 English');
    if (style.preferredChartType && style.preferredChartType !== 'auto') {
      styleParts.push(
        `图表偏好 \`${style.preferredChartType}\`（但若数据明显不适合，可自决换更好的类型）`,
      );
    }
    if (styleParts.length === 0) return null;
    return [
      '# 🎨 风格偏好（用户设置）',
      ...styleParts.map((s) => `- ${s}`),
      '',
      '这是**风格约束**，不影响你的分析结论。',
    ].join('\n');
  }

  /**
   * Content 注入 — 关注领域 / 熟悉术语，跟话题相关，主题切换时应挂起。
   */
  buildContentInjection(profile: UserProfile): string | null {
    const content = profile.contentMemory || {};
    const contentParts: string[] = [];
    if (content.oneLinerSummary) contentParts.push(content.oneLinerSummary);
    if (content.interestTopics?.length)
      contentParts.push(`常关注：${content.interestTopics.join('、')}`);
    if (content.knownTerms?.length)
      contentParts.push(`熟悉术语：${content.knownTerms.join('、')}（可直接用，不必解释）`);
    if (content.defaultDateRange) contentParts.push(`习惯时间窗口：${content.defaultDateRange}`);
    if (contentParts.length === 0) return null;

    return [
      '# 👤 用户关注画像（自动学习 — soft prior）',
      ...contentParts.map((s) => `- ${s}`),
      '',
      '## ⚠️ 重要：这是 soft prior 不是 hard constraint',
      '上面的偏好用于让你回答更贴心 — 但**绝不应改变你的分析方法或结论**：',
      '- 如果数据揭示了用户的盲区 / 错误假设 / 反预期模式，**主动指出**',
      '- 用户熟悉的术语可以直接用，但**不要强行带这些术语**，自然才好',
      '- 你是助手，不是回声 — 用户需要的是真实洞察，不是"对，你说得对"',
    ].join('\n');
  }

  /**
   * 主题切换检测 — 决定这次 chat 是否挂起 Content Memory。
   *
   * 双信号策略（无 embedding 依赖）：
   *   - **高信号**：interestTopics + knownTerms — 用户明确关注的领域词
   *     命中 ≥ 1 个 → 认为 in-scope（不切换）
   *   - **低信号**：oneLinerSummary 分词 — 只是描述性关键词
   *     无高信号命中，看低信号 hit rate ≥ 30% → in-scope
   *   - 都不命中 + profile 非空 → 判定切换
   *
   * 输出用于 Planner 决定是否挂起 ContentMemory；reason 供 log 观测。
   */
  detectTopicMismatch(
    profile: UserProfile,
    question: string,
  ): { mismatch: boolean; hits: string[]; reason: string } {
    const content = profile.contentMemory || {};
    const highSignal = new Set<string>();
    const lowSignal = new Set<string>();
    (content.interestTopics || []).forEach((t) => this.addKeywords(highSignal, t));
    (content.knownTerms || []).forEach((t) => this.addKeywords(highSignal, t));
    if (content.oneLinerSummary) this.addKeywords(lowSignal, content.oneLinerSummary);

    if (highSignal.size === 0 && lowSignal.size === 0) {
      return { mismatch: false, hits: [], reason: 'no-content-memory' };
    }

    const qLower = question.toLowerCase();
    const highHits: string[] = [];
    for (const kw of highSignal) {
      if (qLower.includes(kw.toLowerCase())) highHits.push(kw);
    }
    if (highHits.length > 0) {
      return {
        mismatch: false,
        hits: highHits,
        reason: `matched ${highHits.length} high-signal keyword(s): ${highHits.join(',')}`,
      };
    }
    // 无高信号命中 — 看低信号是否够多
    const lowHits: string[] = [];
    for (const kw of lowSignal) {
      if (qLower.includes(kw.toLowerCase())) lowHits.push(kw);
    }
    const lowHitRate = lowSignal.size > 0 ? lowHits.length / lowSignal.size : 0;
    if (lowHitRate >= 0.3) {
      return {
        mismatch: false,
        hits: lowHits,
        reason: `low-signal hit ${(lowHitRate * 100).toFixed(0)}% — likely in-scope`,
      };
    }
    return {
      mismatch: true,
      hits: [],
      reason: 'no high-signal or low-signal hit — content memory suspended',
    };
  }

  /** 从一段文字里挖关键词（去除虚词/标点/短词）*/
  private addKeywords(set: Set<string>, text: string): void {
    const cleaned = text.replace(/[，,。.、;；:：!?？（）()\-]+/g, ' ');
    for (const tok of cleaned.split(/\s+/)) {
      if (tok.length >= 2 && tok.length <= 20) set.add(tok);
    }
  }
}
