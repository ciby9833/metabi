/**
 * 与后端 API 对齐的类型定义
 */

// ============================ Datasource ============================
export type DatasourceType =
  | 'postgresql'
  | 'mysql'
  | 'clickhouse'
  | 'api'
  | 'csv'
  | 'excel';

export interface Datasource {
  id: string;
  name: string;
  type: DatasourceType;
  description?: string;
  config: Record<string, any>;
  isActive: boolean;
  datasetNames: string[];
  createdAt: string;
  updatedAt: string;
}

export interface CreateDatasourcePayload {
  name: string;
  type: DatasourceType;
  description?: string;
  config: Record<string, any>;
  datasetNames?: string[];
}

export interface TestConnectionPayload {
  type: DatasourceType;
  config: Record<string, any>;
}

export interface ConnectionTestResult {
  success: boolean;
  message: string;
  serverVersion?: string;
  latencyMs?: number;
}

// ============================ Metadata ============================
export interface TableMetadata {
  id: string;
  datasourceId: string;
  tableName: string;
  columnName?: string | null;
  businessName?: string;
  description?: string;
  unit?: string;
  timezone?: string;
  synonyms: string[];
  createdAt: string;
  updatedAt: string;
}

export interface GlossaryItem {
  id: string;
  datasourceId: string;
  term: string;
  meaning: string;
  exampleSql?: string;
  appliesToTables: string[];
  createdAt: string;
  updatedAt: string;
}

export interface SuggestedQuestion {
  id: string;
  datasourceId: string;
  questionText: string;
  source: 'manual' | 'learned';
  learnedSql?: string;
  priority: number;
  createdBy?: string;
  createdAt: string;
}

// ============================ Conversation ============================
export interface Conversation {
  id: string;
  userId: string;
  title?: string;
  datasourceId?: string;
  projectId?: string | null;
  lockedSkillName?: string | null;
  /** 对话模式：single_skill (默认) | master (Master Agent 跨 Skill 智能调度) */
  mode?: 'single_skill' | 'master';
  createdAt: string;
  updatedAt: string;
}

export type MessageRole = 'user' | 'assistant' | 'system';

export interface ToolCallLog {
  step: number;
  name: string;
  input: any;
  output: any;
  durationMs: number;
  error?: string;
  timestamp: string;
}

export interface ProvenanceFooter {
  skill: { name: string; version: string };
  toolCallCount: number;
  steps: ToolCallLog[];
  totalLatencyMs: number;
  totalTokens: number;
  review?: {
    confidence: number;
    concerns: string[];
    summary: string;
  };
}

export interface LineageBadge {
  schema: string;
  table: string;
  estimatedRowCount?: number;
  sizeBytes?: number;
  lastActivityAt?: string;
  lastAnalyzedAt?: string;
  lastActivityHuman?: string;
}

export type InsightSeverity = 'info' | 'warning' | 'critical';
export type InsightKind = 'anomaly' | 'concentration' | 'data_quality' | 'trend' | 'business' | 'attribution';

export interface Insight {
  severity: InsightSeverity;
  text: string;
  kind?: InsightKind;
}

export interface Message {
  id: string;
  conversationId: string;
  role: MessageRole;
  content: string;
  /** 附件 id 列表 —— 详情通过 chatService.getAttachment(id) 拉 */
  attachments?: string[];
  sqlText?: string;
  chartConfig?: ChartConfig;
  resultData?: {
    columns?: { name: string; type: string }[];
    rowCount?: number;
    sampleRows?: Record<string, any>[];
  };
  metadata?: {
    confidence?: number;
    refused?: boolean;
    refuseReason?: string;
    executionTimeMs?: number;
    fromCache?: boolean;
    provenance?: ProvenanceFooter;
    insights?: Insight[];
    suggestedFollowUps?: string[];
    relatedHints?: string[];
    lineage?: LineageBadge[];
    /** 技术字段名 → 业务展示名 */
    columnDisplayMap?: Record<string, string>;
    /** Agent 主动调起的关键澄清请求 — 前端渲染澄清卡片 */
    clarify?: {
      question: string;
      /**
       * 候选项 — 兼容两种形态：
       *   - 老：string 简写
       *   - 新：{ value, pros?, cons?, recommended? } 对象（推荐，可展示优劣评注）
       */
      options?: Array<
        | string
        | {
            value: string;
            pros?: string;
            cons?: string;
            recommended?: boolean;
          }
      >;
      reason?: string;
    };
  };
  createdAt: string;
}

// ============================ Chart ============================
export type ChartType = 'line' | 'bar' | 'pie' | 'table' | 'scatter' | 'heatmap';

export interface ChartConfig {
  type: ChartType;
  option?: Record<string, any>;
  table?: {
    columns: { title: string; dataIndex: string; key: string }[];
    rows: Record<string, any>[];
  };
}

// ============================ Orchestrate result ============================
export interface OrchestrateResult {
  narrative: string;
  sql?: string;
  confidence: number;
  refused: boolean;
  refuseReason?: string;
  chart: ChartConfig;
  resultSummary: {
    rowCount: number;
    truncated: boolean;
    executionTimeMs: number;
    fromCache: boolean;
  };
  data: {
    columns: { name: string; type: string }[];
    rows: Record<string, any>[];
  };
  provenance: ProvenanceFooter;
}

export interface SendMessageResponse {
  conversationId: string;
  userMessageId: string;
  assistantMessageId: string;
  result: OrchestrateResult;
}

// ============================ User Dataset (Self-Service Upload) ============================
export type DatasetStatus =
  | 'pending'
  | 'parsing'
  | 'awaiting_confirm'
  | 'importing'
  | 'ready'
  | 'failed';

export type DatasetColumnType =
  | 'text'
  | 'integer'
  | 'numeric'
  | 'boolean'
  | 'timestamp'
  | 'date';

export interface DatasetColumn {
  /** 入库列名（已 sanitize：小写下划线 ascii）*/
  name: string;
  /** 原始列名（如 "客户姓名"）*/
  originalName?: string;
  type: DatasetColumnType;
  /** 业务描述（注入 Planner prompt 让 LLM 知道列含义）*/
  description?: string;
  /** 前 5 行样本（推断阶段返回）*/
  sample?: any[];
  /** 空值率 0..1 */
  nullRatio?: number;
  /** 跳过该列不入库 */
  skipped?: boolean;
}

export interface UserDataset {
  id: string;
  ownerId: string;
  /** dataset 必属于某 project（个人工作区也是 project）*/
  projectId: string;
  sourceFilename: string;
  sourceSizeBytes: number;
  sourceMime: string;
  tableName: string | null;
  displayName: string;
  description: string | null;
  columns: DatasetColumn[] | null;
  rowCount: number | null;
  status: DatasetStatus;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
}

// ============================ Task ============================
export interface Task {
  id: string;
  name: string;
  description?: string;
  question: string;
  cronExpression?: string;
  datasourceId?: string;
  feishuWebhook?: string;
  isActive: boolean;
  lastRunAt?: string;
  nextRunAt?: string;
  lastStatus?: 'pending' | 'running' | 'success' | 'failed' | 'disabled';
  retryCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface CreateTaskPayload {
  name: string;
  description?: string;
  question: string;
  cronExpression: string;
  datasourceId: string;
  feishuWebhook?: string;
  isActive?: boolean;
}

// ============================ List wrapper ============================
export interface ListResponse<T> {
  data: T[];
  total: number;
}
