import { Entity, Column, Index, ManyToOne, JoinColumn } from 'typeorm';
import { BaseEntity } from './base.entity';
import { Project } from './project.entity';
import { User } from './user.entity';

export type ProjectRole = 'owner' | 'admin' | 'editor' | 'viewer';
//   owner  - 创建者，唯一一个（同 Project.ownerId），可转让
//   admin  - 可邀请 / 移除成员、改项目设置
//   editor - 可在项目内创建/编辑/删除对话
//   viewer - 只读

@Entity({ name: 'project_members', schema: 'app' })
@Index('uq_project_user', ['projectId', 'userId'], { unique: true })
export class ProjectMember extends BaseEntity {
  @Column({ name: 'project_id', type: 'uuid' })
  projectId: string;

  @ManyToOne(() => Project, (p) => p.members, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'project_id' })
  project?: Project;

  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user?: User;

  @Column({ type: 'varchar', length: 20, default: 'editor' })
  role: ProjectRole;

  @Column({ name: 'invited_by', type: 'uuid', nullable: true })
  invitedBy?: string | null;
}
