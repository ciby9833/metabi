import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/**
 * Widget — Dashboard 里的一个组件卡片
 *
 * 每个 widget 自带数据源引用（支持混合多源）：
 *   - datasourceId 非空 → 企业库场景，用 SQL Engine 跑
 *   - datasetIds 非空 → dataset 场景，白名单限定这些 dataset 表
 *   - 两个字段互斥
 */
@Entity({ name: 'widgets', schema: 'app' })
export class Widget {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ type: 'uuid', name: 'dashboard_id' })
  dashboardId: string;

  @Column({ type: 'varchar', length: 255 })
  title: string;

  @Column({ type: 'text', nullable: true })
  description: string | null;

  // ============ 数据源引用（互斥）============

  /** 企业数据源 id（datasourceId 非空时用它跑 SQL）*/
  @Column({ type: 'uuid', name: 'datasource_id', nullable: true })
  datasourceId: string | null;

  /** Dataset 模式：白名单 dataset id 列表（jsonb 数组）*/
  @Column({ name: 'dataset_ids', type: 'jsonb', nullable: true })
  datasetIds: string[] | null;

  /** dataset 模式必须指定所属 project（继承权限）*/
  @Column({ type: 'uuid', name: 'project_id', nullable: true })
  projectId: string | null;

  // ============ 内容 ============

  /** 图表 SQL —— 可包含 {{key}} 占位符引用 params（聚合后展示用）*/
  @Column({ type: 'text' })
  sql: string;

  /**
   * 明细 SQL —— 存到看板时 AI 自动脱聚合生成
   *
   * 场景：
   *   - 下载明细：直接跑 detailSql（避免每次调 LLM）
   *   - AI 解读：给 LLM 看明细样本（比图表聚合数据更能挖出洞见）
   *
   * null 时：exportData(mode=detail) 会现场调 LLM 生成
   * 空字符串："" 视同 sql（原 SQL 本身就是明细，无需脱聚合）
   */
  @Column({ name: 'detail_sql', type: 'text', nullable: true })
  detailSql: string | null;

  /**
   * 参数化 schema — 用户在看板顶部改这些值 → 全 widget 联动重算
   *
   * SQL 里写 {{startDate}}，params 里定义：
   *   { key: 'startDate', label: '开始日期', type: 'date', default: '2024-01-01' }
   *
   * type 决定前端控件 + 后端类型转换：
   *   - date: 单日期 → 'YYYY-MM-DD'
   *   - daterange: 日期范围 → 2 个占位符 {{startDate}} / {{endDate}}
   *   - enum: 下拉 → options 必填
   *   - number: 数字输入
   *   - text: 文本
   */
  @Column({ type: 'jsonb', nullable: true })
  params: Array<{
    key: string;
    label: string;
    type: 'date' | 'daterange' | 'enum' | 'number' | 'text';
    default?: any;
    options?: string[];
  }> | null;

  /**
   * 图表配置：{ type: 'bar'|'line'|'pie'|'table'|'kpi', options?: {...} }
   * 结构与 ChartAgent 的输出兼容，前端复用同一 renderer
   */
  @Column({ name: 'chart_config', type: 'jsonb' })
  chartConfig: {
    type: 'bar' | 'line' | 'pie' | 'table' | 'kpi';
    options?: Record<string, any>;
  };

  /**
   * 最近一次执行的结果快照 —— 打开看板时先显示这个（秒回），
   * 然后异步刷新。避免每次都 spinner。
   * 缓存 {columns, rows, rowCount, refreshedAt}
   */
  @Column({ name: 'result_snapshot', type: 'jsonb', nullable: true })
  resultSnapshot: {
    columns: Array<{ name: string; type: string }>;
    rows: Record<string, any>[];
    rowCount: number;
    refreshedAt: string;
  } | null;

  // ============ 布局（MVP 简单版）============

  /** 排列顺序（0-based）*/
  @Column({ type: 'int', default: 0 })
  position: number;

  /** 宽度：full = 12 格；half = 6 格；third = 4 格 */
  @Column({ type: 'varchar', length: 10, default: 'half' })
  width: 'full' | 'half' | 'third';

  /** 高度：small = 200px；medium = 320px；large = 480px */
  @Column({ type: 'varchar', length: 10, default: 'medium' })
  height: 'small' | 'medium' | 'large';

  @Column({ name: 'created_at', type: 'timestamptz', default: () => 'CURRENT_TIMESTAMP' })
  createdAt: Date;

  @Column({ name: 'updated_at', type: 'timestamptz', default: () => 'CURRENT_TIMESTAMP' })
  updatedAt: Date;
}
