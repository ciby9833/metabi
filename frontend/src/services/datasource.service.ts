import { api } from '@/lib/api';
import {
  ConnectionTestResult,
  CreateDatasourcePayload,
  Datasource,
  ListResponse,
  TestConnectionPayload,
} from '@/types';

export const datasourceService = {
  async list(): Promise<ListResponse<Datasource>> {
    const res = await api.get<ListResponse<Datasource>>('/v1/datasource');
    return res.data;
  },

  async create(payload: CreateDatasourcePayload): Promise<Datasource> {
    const res = await api.post<Datasource>('/v1/datasource', payload);
    return res.data;
  },

  async getById(id: string): Promise<Datasource> {
    const res = await api.get<Datasource>(`/v1/datasource/${id}`);
    return res.data;
  },

  async update(
    id: string,
    payload: Partial<CreateDatasourcePayload> & { isActive?: boolean },
  ): Promise<Datasource> {
    const res = await api.patch<Datasource>(`/v1/datasource/${id}`, payload);
    return res.data;
  },

  async remove(id: string): Promise<void> {
    await api.delete(`/v1/datasource/${id}`);
  },

  async testConnection(payload: TestConnectionPayload): Promise<ConnectionTestResult> {
    const res = await api.post<ConnectionTestResult>('/v1/datasource/test', payload);
    return res.data;
  },

  async listTables(id: string, schema?: string): Promise<string[]> {
    const res = await api.get<string[]>(`/v1/datasource/${id}/tables`, {
      params: { schema },
    });
    return res.data;
  },

  async describeTable(
    id: string,
    table: string,
    schema?: string,
  ): Promise<{
    name: string;
    schema?: string;
    columns: { name: string; type: string; nullable?: boolean }[];
  }> {
    const res = await api.get<{
      name: string;
      schema?: string;
      columns: { name: string; type: string; nullable?: boolean }[];
    }>(`/v1/datasource/${id}/tables/${table}`, { params: { schema } });
    return res.data;
  },

  /** 批量拉多张表的字段（@ 联想用）*/
  async describeMany(
    id: string,
    tables: string[],
    schema?: string,
  ): Promise<Record<string, { name: string; type: string; nullable?: boolean }[]>> {
    if (tables.length === 0) return {};
    const res = await api.get<Record<string, any[]>>(
      `/v1/datasource/${id}/tables-columns`,
      { params: { tables: tables.join(','), schema } },
    );
    return res.data;
  },
};
