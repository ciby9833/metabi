import { Column, Entity, Index, VersionColumn } from 'typeorm';
import { BaseEntity } from './base.entity';

/**
 * Skill 数据库实体
 *
 * 之前 Skill 是 git 仓库里的 .md 文件，每次改要重新打包发版。
 * 现在改成 DB 存储，前端可在线编辑、即时生效。
 *
 * 首次启动若表为空，会从 src/providers/skills/definitions/*.md 自动 seed。
 * VersionColumn 用于并发编辑冲突检测（前端保存时带 version，DB 不匹配则报错）。
 */
@Entity({ name: 'skills', schema: 'app' })
export class SkillEntity extends BaseEntity {
  @Index({ unique: true })
  @Column({ type: 'varchar', length: 100 })
  name: string;

  /** 业务版本号，由编辑者填写（不同于 entity version） */
  @Column({ type: 'varchar', length: 50, default: '1.0.0' })
  version: string;

  @Column({ type: 'text' })
  description: string;

  /** 触发关键词，用 | 分隔 */
  @Column({ type: 'text', nullable: true })
  match: string | null;

  @Column({ type: 'int', default: 0 })
  priority: number;

  /** 表白名单（含 schema 前缀），空 = 不限制 */
  @Column({ type: 'jsonb', nullable: true })
  tables: string[] | null;

  /** 可归因维度 */
  @Column({ name: 'attributable_dimensions', type: 'jsonb', nullable: true })
  attributableDimensions: string[] | null;

  /** 适用的数据源类型 */
  @Column({ name: 'datasource_types', type: 'jsonb', nullable: true })
  datasourceTypes: string[] | null;

  /** Markdown 正文（不含 frontmatter）*/
  @Column({ type: 'text' })
  body: string;

  /** 是否启用（关掉则 SkillRouter 不会路由到它）*/
  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean;

  /** 上一版的 body，一键回滚用 */
  @Column({ name: 'previous_body', type: 'text', nullable: true })
  previousBody: string | null;

  /** 数据来源：'seed' = 从 .md seed 来的；'user' = 前端创建/编辑过 */
  @Column({ type: 'varchar', length: 20, default: 'user' })
  source: 'seed' | 'user';

  @Column({ name: 'updated_by', type: 'uuid', nullable: true })
  updatedBy: string | null;

  /**
   * Skill 可见性（学 Claude Project / Notion 私页模型）：
   *   - 'global'    所有用户可见（DBA 发布的企业通用 skill，默认）
   *   - 'project'   仅该 project 成员可见（部门定制 skill；需配合 projectId）
   *   - 'personal'  仅 owner 可见（需配合 ownerUserId）
   *
   * 设计原则（context-align）：仅做 access control（可见性），不做行为约束。
   * Skill 内部的 body / metadata 该让 LLM 看见就看见，不依赖角色定制内容。
   */
  @Column({
    type: 'varchar',
    length: 20,
    default: 'global',
  })
  @Index()
  visibility: 'global' | 'project' | 'personal';

  /** 仅 visibility='project' 时使用 — 该 project 成员可见 */
  @Column({ name: 'project_id', type: 'uuid', nullable: true })
  @Index()
  projectId: string | null;

  /** 仅 visibility='personal' 时使用 — 仅此 user 可见 */
  @Column({ name: 'owner_user_id', type: 'uuid', nullable: true })
  @Index()
  ownerUserId: string | null;

  /**
   * TypeORM 乐观锁版本号
   * 前端保存时必须带上当前 version，DB 不匹配则抛 OptimisticLockVersionMismatchError
   * 防止并发编辑互相覆盖
   */
  @VersionColumn({ name: 'row_version' })
  rowVersion: number;
}
