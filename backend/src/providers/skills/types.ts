/**
 * Skill = 一份 markdown 文档，包含某个业务领域的：
 *   - 业务术语解释（"人效"、"单量"到底怎么算）
 *   - 表/列的语义说明
 *   - 常见陷阱（去重？时区？单位？）
 *   - 工作流（先 sample_rows 验证，再写 SQL...）
 *
 * 灵感来自 Anthropic 的「Self-Service Analytics with Claude」文章。
 * 与 YAML 不同：内容是自由的自然语言，LLM 直接当 context 用。
 */

export interface SkillFrontmatter {
  /** 唯一名称，文件名一致 */
  name: string;
  /** 版本号，方便变更追踪 */
  version: string;
  /** 一句话描述：什么场景调用这个 skill */
  description: string;
  /** 触发关键词/正则（用 | 分隔），SkillRouter 根据问题命中度排序 */
  match?: string;
  /** 数字优先级，命中分数相同时取大的 */
  priority?: number;
  /** 允许的数据源类型（postgresql/mysql/...）, 不填则任意 */
  datasourceTypes?: string[];
  /**
   * 可归因维度：当用户问"为什么/差异/归因"类问题时，
   * Agent 应主动按这些字段分组对比，找出贡献最大的维度。
   * 例：["station_name", "agent_area_name", "hour_of_day"]
   */
  attributableDimensions?: string[];
  /**
   * 允许 Agent 访问的表白名单（含 schema 前缀，如 "dwd.dispatcher_efficiency_detail"）
   * - 不填则不限制（看到 schema 下全部表，适合 dev / 探索 skill）
   * - 填了则 list_tables / sample_rows / run_sql 都只能用这些表
   * - 防止大数据仓库千表场景下 LLM 误判挑错表
   */
  tables?: string[];
}

/** Skill 可见性（access control 层；不限制行为，只限制看不看得到）*/
export type SkillVisibility = 'global' | 'project' | 'personal';

export interface Skill {
  /** 解析自 frontmatter */
  meta: SkillFrontmatter;
  /** markdown 正文（不含 frontmatter） */
  body: string;
  /** 文件绝对路径，方便日志 */
  filePath: string;
  /** 可见性（默认 'global'）*/
  visibility?: SkillVisibility;
  /** visibility='project' 时关联的 project id */
  projectId?: string | null;
  /** visibility='personal' 时的 owner user id */
  ownerUserId?: string | null;
}

export interface SkillMatchResult {
  skill: Skill;
  score: number;
  matchedKeywords: string[];
}

/**
 * 用户上下文（用于 Skill visibility 判断 + Planner system prompt 注入）。
 * 所有字段都是可选的，方便测试 / sub-agent / 兼容老路径。
 */
export interface UserContext {
  userId?: string;
  /** 用户参与的所有 project id（用于 project skill 可见性判断）*/
  accessibleProjectIds?: string[];
  /** Settings 自填，用于 Planner 软引导（"为 X 服务"），不强制行为 */
  department?: string | null;
  jobRole?: string | null;
  /** 显示名（如 email 前缀 / name）*/
  displayName?: string | null;
}

/** 判断 skill 对当前 user 是否可见。空 user 视为 anon — 仅 global 可见 */
export function isSkillVisibleToUser(skill: Skill, user?: UserContext): boolean {
  const v = skill.visibility ?? 'global';
  if (v === 'global') return true;
  if (!user?.userId) return false;
  if (v === 'personal') return skill.ownerUserId === user.userId;
  if (v === 'project') {
    return !!skill.projectId && (user.accessibleProjectIds || []).includes(skill.projectId);
  }
  return false;
}
