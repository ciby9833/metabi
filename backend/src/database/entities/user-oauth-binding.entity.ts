import { Entity, Column, Index, ManyToOne, JoinColumn } from 'typeorm';
import { BaseEntity } from './base.entity';
import { User } from './user.entity';

export type OAuthProvider = 'google' | 'feishu';

@Entity({ name: 'user_oauth_bindings', schema: 'app' })
@Index('uq_oauth_provider_pid', ['provider', 'providerUserId'], { unique: true })
export class UserOAuthBinding extends BaseEntity {
  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;

  @ManyToOne(() => User, (u) => u.oauthBindings, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;

  @Column({ type: 'varchar', length: 20 })
  provider: OAuthProvider;

  @Column({ name: 'provider_user_id', type: 'varchar', length: 255 })
  providerUserId: string;

  @Column({ name: 'provider_email', type: 'varchar', length: 255, nullable: true })
  providerEmail?: string | null;

  @Column({ name: 'provider_name', type: 'varchar', length: 255, nullable: true })
  providerName?: string | null;

  @Column({ name: 'provider_avatar_url', type: 'varchar', length: 500, nullable: true })
  providerAvatarUrl?: string | null;
}
