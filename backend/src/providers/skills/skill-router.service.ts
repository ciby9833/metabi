import { Injectable, Logger } from '@nestjs/common';
import { SkillLoaderService } from './skill-loader.service';
import { Skill, SkillMatchResult, UserContext, isSkillVisibleToUser } from './types';

/**
 * SkillRouter
 *
 * 根据用户问题挑一个最相关的 Skill。
 * MVP 用关键词/正则匹配 + 优先级；后续可升级为向量召回。
 *
 * 永远不会"找不到 skill" —— 如果都不匹配，返回 general-data-query 作为兜底。
 */
@Injectable()
export class SkillRouterService {
  private readonly logger = new Logger(SkillRouterService.name);
  private readonly fallbackSkillName = 'general-data-query';

  constructor(private readonly loader: SkillLoaderService) {}

  /**
   * 给一个问题挑 skill。返回排好序的候选 + 一个最终选定。
   *
   * @param user 可选 — 用于按 visibility 过滤（不传则只暴露 global skills，仍可走 fallback）
   */
  route(
    question: string,
    user?: UserContext,
  ): { selected: Skill; candidates: SkillMatchResult[] } {
    const all = this.loader.getAll();
    if (all.length === 0) {
      throw new Error('No skills loaded; SkillLoader returned empty');
    }

    // 先按可见性过滤 — 不可见的 skill 不参与路由
    const visible = all.filter((s) => isSkillVisibleToUser(s, user));
    if (visible.length === 0) {
      // 极端情况：没有任何可见 skill（admin 还没建任何 global skill）→ 用 fallback
      const fallback = this.loader.getByName(this.fallbackSkillName) || all[0];
      this.logger.warn(`No visible skills for user; using fallback '${fallback.meta.name}'`);
      return { selected: fallback, candidates: [] };
    }

    const matches = visible
      .map((skill) => this.score(skill, question))
      .filter((m) => m.score > 0);
    matches.sort((a, b) => b.score - a.score);

    let selected: Skill | undefined;
    if (matches.length > 0) {
      selected = matches[0].skill;
    } else {
      // fallback 只在它对用户可见时才用
      const fb = this.loader.getByName(this.fallbackSkillName);
      selected = fb && isSkillVisibleToUser(fb, user) ? fb : visible[0];
    }

    this.logger.log(
      `Routing "${question.substring(0, 60)}..." → skill='${selected.meta.name}' (${matches.length} positive matches from ${visible.length} visible)`,
    );
    return { selected, candidates: matches };
  }

  private score(skill: Skill, question: string): SkillMatchResult {
    const keywords = (skill.meta.match || '')
      .split('|')
      .map((s) => s.trim())
      .filter(Boolean);
    if (keywords.length === 0) {
      // 没有 match 字段的 skill 只能靠 fallback 路径召回（score=0）
      return { skill, score: 0, matchedKeywords: [] };
    }
    const q = question.toLowerCase();
    const matched: string[] = [];
    let score = 0;
    for (const kw of keywords) {
      const k = kw.toLowerCase();
      if (q.includes(k)) {
        matched.push(kw);
        score += k.length; // 关键词越长权重越高
      }
    }
    score += (skill.meta.priority || 0) / 10;
    return { skill, score, matchedKeywords: matched };
  }
}
