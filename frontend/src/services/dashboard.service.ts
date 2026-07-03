/**
 * Dashboard + Widget SDK
 */
import { api } from '@/lib/api';

export interface DashboardLayoutItem {
  i: string; // widget id
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Dashboard {
  id: string;
  ownerId: string;
  projectId: string | null;
  name: string;
  description: string | null;
  icon: string | null;
  layout: DashboardLayoutItem[] | null;
  createdAt: string;
  updatedAt: string;
}

export interface WidgetChartConfig {
  type: 'bar' | 'line' | 'pie' | 'table' | 'kpi';
  options?: Record<string, any>;
}

export interface WidgetParam {
  key: string;
  label: string;
  type: 'date' | 'daterange' | 'enum' | 'number' | 'text';
  default?: any;
  options?: string[];
}

export interface Widget {
  id: string;
  dashboardId: string;
  title: string;
  description: string | null;
  datasourceId: string | null;
  datasetIds: string[] | null;
  projectId: string | null;
  sql: string;
  detailSql: string | null;
  params: WidgetParam[] | null;
  chartConfig: WidgetChartConfig;
  resultSnapshot: {
    columns: Array<{ name: string; type: string }>;
    rows: Record<string, any>[];
    rowCount: number;
    refreshedAt: string;
  } | null;
  position: number;
  width: 'full' | 'half' | 'third';
  height: 'small' | 'medium' | 'large';
  createdAt: string;
  updatedAt: string;
}

export const dashboardService = {
  async list(): Promise<Dashboard[]> {
    const res = await api.get<Dashboard[]>('/v1/dashboards');
    return res.data;
  },
  async get(id: string): Promise<Dashboard> {
    const res = await api.get<Dashboard>(`/v1/dashboards/${id}`);
    return res.data;
  },
  async listWidgets(id: string): Promise<Widget[]> {
    const res = await api.get<Widget[]>(`/v1/dashboards/${id}/widgets`);
    return res.data;
  },
  async create(body: {
    name: string;
    description?: string;
    icon?: string;
    projectId?: string | null;
  }): Promise<Dashboard> {
    const res = await api.post<Dashboard>('/v1/dashboards', body);
    return res.data;
  },
  async update(
    id: string,
    body: {
      name?: string;
      description?: string;
      icon?: string;
      projectId?: string | null;
      layout?: DashboardLayoutItem[] | null;
    },
  ): Promise<Dashboard> {
    const res = await api.patch<Dashboard>(`/v1/dashboards/${id}`, body);
    return res.data;
  },
  async remove(id: string): Promise<void> {
    await api.delete(`/v1/dashboards/${id}`);
  },
  async interpret(
    id: string,
    paramValues?: Record<string, any>,
  ): Promise<DashboardInterpretation> {
    const res = await api.post<DashboardInterpretation>(`/v1/dashboards/${id}/interpret`, {
      paramValues,
    });
    return res.data;
  },
};

export interface DashboardInterpretation {
  summary: string;
  anomalies: Array<{ widget: string; description: string }>;
  correlations: Array<{ widgets: string[]; description: string }>;
  recommendations: Array<{ action: string; description: string }>;
  meta: {
    widgetCount: number;
    dataRowsScanned: number;
    generatedAt: string;
  };
}

export const widgetService = {
  async saveFromTurn(body: {
    messageId: string;
    dashboardId?: string;
    newDashboardName?: string;
    newDashboardProjectId?: string | null;
    widgetTitle: string;
    widgetDescription?: string;
    chartType?: WidgetChartConfig['type'];
    params?: WidgetParam[] | null;
  }): Promise<{ dashboard: Dashboard; widget: Widget }> {
    const res = await api.post('/v1/widgets/save-from-turn', body);
    return res.data;
  },
  async update(
    id: string,
    body: Partial<{
      title: string;
      description: string;
      chartConfig: WidgetChartConfig;
      sql: string;
      params: WidgetParam[] | null;
      width: Widget['width'];
      height: Widget['height'];
      position: number;
    }>,
  ): Promise<Widget> {
    const res = await api.patch<Widget>(`/v1/widgets/${id}`, body);
    return res.data;
  },
  async refresh(id: string, paramValues?: Record<string, any>): Promise<Widget> {
    const res = await api.post<Widget>(`/v1/widgets/${id}/refresh`, { paramValues });
    return res.data;
  },
  async remove(id: string): Promise<void> {
    await api.delete(`/v1/widgets/${id}`);
  },
  async suggestParams(sql: string, existingParams?: WidgetParam[] | null): Promise<ParamSuggestion> {
    const res = await api.post<ParamSuggestion>('/v1/widgets/suggest-params', {
      sql,
      existingParams,
    });
    return res.data;
  },
  async interpret(id: string): Promise<WidgetInterpretation> {
    const res = await api.post<WidgetInterpretation>(`/v1/widgets/${id}/interpret`, {});
    return res.data;
  },
};

export interface WidgetInterpretation {
  conclusion: string;
  keyFindings: string[];
  anomalies: Array<{ item: string; description: string }>;
  nextQuestions: string[];
  meta: {
    widgetTitle: string;
    rowsScanned: number;
    generatedAt: string;
  };
}

export interface ParamSuggestion {
  suggestedSql: string;
  suggestedParams: WidgetParam[];
  changes: Array<{ from: string; toPlaceholder: string; reason: string }>;
}
