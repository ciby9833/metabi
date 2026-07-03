import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/**
 * Dashboard（看板）— 用户固化的分析产物
 *
 * 双归属模型（学 Claude Personal / Team Project）：
 *   - projectId=null → 个人看板（仅 ownerId 可访问）
 *   - projectId 非空 → 项目看板（project member 按 role 访问）
 *
 * 混合多源：一个 dashboard 里的 widgets 可以分别来自
 *   企业 datasource 或 dataset — 权限在 widget 级校验（读时验证每个 widget 的数据源）
 */
@Entity({ name: 'dashboards', schema: 'app' })
export class Dashboard {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** 创建者（永远 owner，不可转移；用于个人看板权限）*/
  @Index()
  @Column({ type: 'uuid', name: 'owner_id' })
  ownerId: string;

  /** 挂靠 project（null = 个人）*/
  @Index()
  @Column({ type: 'uuid', name: 'project_id', nullable: true })
  projectId: string | null;

  @Column({ type: 'varchar', length: 255 })
  name: string;

  @Column({ type: 'text', nullable: true })
  description: string | null;

  /** 显示图标 emoji */
  @Column({ type: 'varchar', length: 10, nullable: true })
  icon: string | null;

  /**
   * 网格布局 — react-grid-layout 兼容格式
   * [{i: widgetId, x, y, w, h}]，null 时前端 fallback 到默认布局
   */
  @Column({ type: 'jsonb', nullable: true })
  layout: Array<{ i: string; x: number; y: number; w: number; h: number }> | null;

  @Column({ name: 'created_at', type: 'timestamptz', default: () => 'CURRENT_TIMESTAMP' })
  createdAt: Date;

  @Column({ name: 'updated_at', type: 'timestamptz', default: () => 'CURRENT_TIMESTAMP' })
  updatedAt: Date;
}
