import { Entity, Column, Index, ManyToOne, OneToMany, JoinColumn } from 'typeorm';
import { BaseEntity } from './base.entity';
import { User } from './user.entity';
import { Message } from './message.entity';
import { Project } from './project.entity';

@Entity({ name: 'conversations', schema: 'app' })
export class Conversation extends BaseEntity {
  @Index()
  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;

  @ManyToOne(() => User, (user) => user.conversations, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;

  @Column({ type: 'varchar', length: 255, nullable: true })
  title?: string;

  @Column({ name: 'datasource_id', type: 'uuid', nullable: true })
  datasourceId?: string;

  /**
   * 关联的 Project（可选）。
   * 不为空时：所有 project 成员都能访问该对话；Planner 会拿到 project.systemInstructions
   * 为空时：对话归个人，仅 owner 可见
   */
  @Index()
  @Column({ name: 'project_id', type: 'uuid', nullable: true })
  projectId?: string | null;

  @ManyToOne(() => Project, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'project_id' })
  project?: Project | null;

  /**
   * 会话锁定的 Skill 名。**single_skill 模式下**第 1 轮 router 选定后写入。
   * master 模式下不强制锁定（Master 自由调度子 agent）。
   */
  @Column({ name: 'locked_skill_name', type: 'varchar', length: 100, nullable: true })
  lockedSkillName?: string;

  /**
   * 对话模式：
   *  - 'single_skill'（默认/老对话）：固定一个 Skill 走老路径，性能更好
   *  - 'master'：MasterAgent 自由调度多个子 agent（跨 skill 智能调度），更强但更贵
   */
  @Column({ name: 'mode', type: 'varchar', length: 20, default: 'single_skill' })
  mode: 'single_skill' | 'master';

  @OneToMany(() => Message, (message) => message.conversation, {
    cascade: true,
  })
  messages: Message[];
}
