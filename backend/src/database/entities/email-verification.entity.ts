import { Entity, Column, Index } from 'typeorm';
import { BaseEntity } from './base.entity';

export type EmailVerificationPurpose = 'register' | 'reset_password' | 'change_email';

/**
 * 邮箱验证码
 *
 * - 注册 / 找回密码 / 改邮箱 共用一张表，按 purpose 区分
 * - code 6 位数字
 * - expiresAt：默认 10 分钟
 * - consumedAt：已使用，防重放
 *
 * 限频靠 service 层（同邮箱 cooldown 秒级 + 每天上限）
 */
@Entity({ name: 'email_verifications', schema: 'app' })
@Index('idx_email_verif_email_purpose', ['email', 'purpose'])
@Index('idx_email_verif_expires', ['expiresAt'])
export class EmailVerification extends BaseEntity {
  @Column({ type: 'varchar', length: 255 })
  email: string;

  @Column({ type: 'varchar', length: 6 })
  code: string;

  @Column({ type: 'varchar', length: 30 })
  purpose: EmailVerificationPurpose;

  @Column({ name: 'expires_at', type: 'timestamptz' })
  expiresAt: Date;

  @Column({ name: 'consumed_at', type: 'timestamptz', nullable: true })
  consumedAt?: Date | null;

  @Column({ name: 'request_ip', type: 'varchar', length: 45, nullable: true })
  requestIp?: string | null;
}
