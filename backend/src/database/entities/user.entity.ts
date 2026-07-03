import { Entity, Column, Index, OneToMany } from 'typeorm';
import { BaseEntity } from './base.entity';
import { Conversation } from './conversation.entity';
import { UserOAuthBinding } from './user-oauth-binding.entity';

@Entity({ name: 'users', schema: 'app' })
export class User extends BaseEntity {
  @Index({ unique: true })
  @Column({ type: 'varchar', length: 255 })
  email: string;

  @Column({ type: 'varchar', length: 255 })
  name: string;

  /** bcrypt hash；OAuth-only 用户可空 */
  @Column({ name: 'password_hash', type: 'varchar', length: 255, nullable: true })
  passwordHash?: string | null;

  @Column({ name: 'email_verified_at', type: 'timestamptz', nullable: true })
  emailVerifiedAt?: Date | null;

  @Column({ name: 'avatar_url', type: 'varchar', length: 500, nullable: true })
  avatarUrl?: string | null;

  @Column({ name: 'last_login_at', type: 'timestamptz', nullable: true })
  lastLoginAt?: Date | null;

  @Column({ name: 'last_login_ip', type: 'varchar', length: 45, nullable: true })
  lastLoginIp?: string | null;

  /** 系统管理员标记。后续做团队/RBAC 时换成 role 表 */
  @Column({ name: 'is_admin', type: 'boolean', default: false })
  isAdmin: boolean;

  @Index()
  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean;

  /**
   * 部门（如"财务部"/"销售运营"）— 可选；用户在 Settings 自填。
   * 注入 Planner system prompt 作为软引导（不强制行为，只让 LLM 知道服务对象）。
   * 不做 HR 系统级组织树，只是字符串标签。
   */
  @Column({ type: 'varchar', length: 100, nullable: true })
  department?: string | null;

  /**
   * 职能角色（如"分析师"/"经理"/"总监"）— 可选。
   * 同上：注入 prompt 软引导，不做 RBAC matrix。
   */
  @Column({ name: 'job_role', type: 'varchar', length: 100, nullable: true })
  jobRole?: string | null;

  @OneToMany(() => Conversation, (conversation) => conversation.user)
  conversations: Conversation[];

  @OneToMany(() => UserOAuthBinding, (b) => b.user)
  oauthBindings: UserOAuthBinding[];
}
