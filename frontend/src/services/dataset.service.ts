/**
 * Dataset 前端 SDK — 用户上传 + 3 阶段确认 + 共享归属管理。
 */
import { api } from '@/lib/api';
import { DatasetColumn, UserDataset } from '@/types';

export interface ConfirmDatasetPayload {
  displayName?: string;
  description?: string;
  /** null = personal; uuid = 挂到该项目（项目成员都可访问）*/
  projectId?: string | null;
  columns: DatasetColumn[];
}

export interface UpdateDatasetPayload {
  displayName?: string;
  description?: string;
  /** null = 改回 personal；uuid = 转到新项目 */
  projectId?: string | null;
}

export const datasetService = {
  /** 上传 CSV/Excel — 同步解析并返回推断的 schema preview。下一步调 confirm 入库。*/
  async upload(file: File, onProgress?: (pct: number) => void): Promise<UserDataset> {
    const form = new FormData();
    form.append('file', file);
    const res = await api.post<UserDataset>('/v1/datasets/upload', form, {
      headers: { 'Content-Type': 'multipart/form-data' },
      onUploadProgress: (e) => {
        if (onProgress && e.total) onProgress(Math.round((e.loaded / e.total) * 100));
      },
    });
    return res.data;
  },

  /** 确认 schema 并入库 — 用户编辑列名/类型/描述/归属后调 */
  async confirm(id: string, payload: ConfirmDatasetPayload): Promise<UserDataset> {
    const res = await api.post<UserDataset>(`/v1/datasets/${id}/confirm`, payload);
    return res.data;
  },

  async list(): Promise<UserDataset[]> {
    const res = await api.get<UserDataset[]>('/v1/datasets');
    return res.data;
  },

  async get(id: string): Promise<UserDataset> {
    const res = await api.get<UserDataset>(`/v1/datasets/${id}`);
    return res.data;
  },

  async update(id: string, payload: UpdateDatasetPayload): Promise<UserDataset> {
    const res = await api.patch<UserDataset>(`/v1/datasets/${id}`, payload);
    return res.data;
  },

  async delete(id: string): Promise<void> {
    await api.delete(`/v1/datasets/${id}`);
  },
};
