import { Column, Entity, Index } from 'typeorm';
import { BaseEntity } from './base.entity';

/**
 * 推荐问题：数据源详情页可维护一组示范问题
 * 前端 Chat 选择数据源后展示成可点击 chip
 */
@Entity({ name: 'datasource_suggested_question', schema: 'app' })
export class SuggestedQuestion extends BaseEntity {
  @Index()
  @Column({ name: 'datasource_id', type: 'uuid' })
  datasourceId: string;

  @Column({ name: 'question_text', type: 'text' })
  questionText: string;

  /** 来源：'manual' = 后台手动添加；'learned' = 从用户标记为好的对话沉淀 */
  @Column({ type: 'varchar', length: 20, default: 'manual' })
  source: 'manual' | 'learned';

  /** 当 source=learned 时，关联的成功 SQL（可作为 few-shot 注入 prompt）*/
  @Column({ name: 'learned_sql', type: 'text', nullable: true })
  learnedSql?: string;

  /** 展示排序（数字大优先）*/
  @Column({ type: 'int', default: 0 })
  priority: number;

  @Column({ name: 'created_by', type: 'uuid', nullable: true })
  createdBy?: string;
}
