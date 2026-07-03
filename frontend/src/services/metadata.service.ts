import { api } from '@/lib/api';
import { GlossaryItem, SuggestedQuestion, TableMetadata } from '@/types';

export const metadataService = {
  // 全部元数据
  async listAll(datasourceId: string): Promise<TableMetadata[]> {
    const res = await api.get<TableMetadata[]>(`/v1/datasource/${datasourceId}/metadata`);
    return res.data;
  },

  // 表元数据
  async getTable(
    datasourceId: string,
    tableName: string,
  ): Promise<{ table: TableMetadata | null; columns: TableMetadata[] }> {
    const res = await api.get(`/v1/datasource/${datasourceId}/metadata/tables/${tableName}`);
    return res.data as any;
  },

  async upsertTable(
    datasourceId: string,
    tableName: string,
    payload: { businessName?: string; description?: string; timezone?: string; synonyms?: string[] },
  ): Promise<TableMetadata> {
    const res = await api.put<TableMetadata>(
      `/v1/datasource/${datasourceId}/metadata/tables/${tableName}`,
      payload,
    );
    return res.data;
  },

  async batchUpsertColumns(
    datasourceId: string,
    tableName: string,
    columns: Array<{
      columnName: string;
      businessName?: string;
      description?: string;
      unit?: string;
      synonyms?: string[];
    }>,
  ): Promise<TableMetadata[]> {
    const res = await api.put<TableMetadata[]>(
      `/v1/datasource/${datasourceId}/metadata/tables/${tableName}/columns`,
      { columns },
    );
    return res.data;
  },

  // 术语词典
  async listGlossary(datasourceId: string): Promise<GlossaryItem[]> {
    const res = await api.get<GlossaryItem[]>(`/v1/datasource/${datasourceId}/glossary`);
    return res.data;
  },

  async createGlossary(
    datasourceId: string,
    payload: {
      term: string;
      meaning: string;
      exampleSql?: string;
      appliesToTables?: string[];
    },
  ): Promise<GlossaryItem> {
    const res = await api.post<GlossaryItem>(`/v1/datasource/${datasourceId}/glossary`, payload);
    return res.data;
  },

  async updateGlossary(
    datasourceId: string,
    id: string,
    payload: {
      term: string;
      meaning: string;
      exampleSql?: string;
      appliesToTables?: string[];
    },
  ): Promise<GlossaryItem> {
    const res = await api.patch<GlossaryItem>(
      `/v1/datasource/${datasourceId}/glossary/${id}`,
      payload,
    );
    return res.data;
  },

  async deleteGlossary(datasourceId: string, id: string): Promise<void> {
    await api.delete(`/v1/datasource/${datasourceId}/glossary/${id}`);
  },

  // 推荐问题
  async listQuestions(datasourceId: string): Promise<SuggestedQuestion[]> {
    const res = await api.get<SuggestedQuestion[]>(
      `/v1/datasource/${datasourceId}/suggested-questions`,
    );
    return res.data;
  },

  async createQuestion(
    datasourceId: string,
    payload: { questionText: string; priority?: number; learnedSql?: string },
  ): Promise<SuggestedQuestion> {
    const res = await api.post<SuggestedQuestion>(
      `/v1/datasource/${datasourceId}/suggested-questions`,
      payload,
    );
    return res.data;
  },

  async deleteQuestion(datasourceId: string, id: string): Promise<void> {
    await api.delete(`/v1/datasource/${datasourceId}/suggested-questions/${id}`);
  },
};
