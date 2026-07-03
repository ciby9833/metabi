import { Entity, Column, Index, ManyToOne, JoinColumn, OneToMany } from 'typeorm';
import { BaseEntity } from './base.entity';
import { User } from './user.entity';
import { ProjectMember } from './project-member.entity';

/**
 * Project（项目 / 工作空间）
 *
 * 一个 Project = 一组对话 + 一个共享指令 + 一组协作成员
 *
 * 价值：
 *   - 跨对话上下文共享：同一项目下所有对话都拿到项目级 systemInstructions
 *   - 团队协作：邀请成员，按 role 分权限
 *   - 组织维度：把"销售 Q3 复盘"、"派件人效专题"等分析专题各自归集
 *
 * 数据隔离规则（P0）：
 *   - owner 默认能看自己的 project
 *   - member（任何角色）也能看
 */
@Entity({ name: 'projects', schema: 'app' })
export class Project extends BaseEntity {
  @Column({ type: 'varchar', length: 255 })
  name: string;

  @Column({ type: 'text', nullable: true })
  description?: string | null;

  /** 项目图标（emoji 或 URL）— 让列表好看一点 */
  @Column({ type: 'varchar', length: 100, nullable: true })
  icon?: string | null;

  @Index()
  @Column({ name: 'owner_id', type: 'uuid' })
  ownerId: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'owner_id' })
  owner?: User;

  /**
   * 项目级"指令" — 同项目下所有对话开始前都会自动注入到 Planner system prompt。
   * 比如：「你正在帮我做 2026 年 H2 销售复盘。所有问题默认按"成单"口径回答。」
   *
   * 是 Skill 之上的一层。Skill 是业务领域知识（如派件、订单），Instruction 是任务上下文（如复盘活动）。
   */
  @Column({ name: 'system_instructions', type: 'text', nullable: true })
  systemInstructions?: string | null;

  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean;

  /**
   * 是否为用户的"个人工作区"自动创建的 project。
   * - 每个用户 ensurePersonalWorkspace 时自动创建唯一一个
   * - UI 上展示为「我的工作区」，不显示成员管理（个人专用）
   * - DB 上有 partial unique index 保证一个 user 最多一个 personal workspace
   */
  @Column({ name: 'is_personal_workspace', type: 'boolean', default: false })
  isPersonalWorkspace: boolean;

  @OneToMany(() => ProjectMember, (m) => m.project, { cascade: true })
  members?: ProjectMember[];
}
