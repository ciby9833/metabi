export const CHART_TYPES = [
  { label: '折线图', value: 'line' },
  { label: '柱状图', value: 'bar' },
  { label: '饼图', value: 'pie' },
  { label: '表格', value: 'table' },
];

export const DATASOURCE_TYPES = [
  { label: 'PostgreSQL', value: 'postgresql' },
  { label: 'MySQL', value: 'mysql' },
  { label: 'ClickHouse', value: 'clickhouse' },
  { label: 'API', value: 'api' },
  { label: 'CSV', value: 'csv' },
  { label: 'Excel', value: 'excel' },
];

export const TASK_STATUS = {
  PENDING: 'pending',
  RUNNING: 'running',
  SUCCESS: 'success',
  FAILED: 'failed',
};

export const API_ENDPOINTS = {
  // Chat
  CHAT: '/chat',
  CHAT_HISTORY: '/chat/{id}/history',
  CHAT_CONVERSATIONS: '/chat/conversations',

  // Datasource
  DATASOURCES: '/datasource',
  DATASOURCE_DETAIL: '/datasource/{id}',
  TEST_CONNECTION: '/datasource/test',

  // Task
  TASKS: '/task',
  TASK_DETAIL: '/task/{id}',
  TASK_EXECUTE: '/task/{id}/execute',

  // Dashboard
  DASHBOARDS: '/dashboard',
  DASHBOARD_DETAIL: '/dashboard/{id}',
};

export const DEFAULT_PAGE_SIZE = 20;
