/**
 * 文件下载 SDK — AI 生成的 Excel/CSV 等附件
 */
import { api } from '@/lib/api';
import { authStorage } from '@/lib/auth-storage';

export interface ExportedFileMeta {
  id: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  description: string | null;
  conversationId: string | null;
  messageId: string | null;
  createdAt: string;
}

const baseURL = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:3000/api';

export const fileService = {
  /** 当前用户的全部导出文件（可选按 conversation 过滤）*/
  async list(conversationId?: string): Promise<ExportedFileMeta[]> {
    const res = await api.get<ExportedFileMeta[]>('/v1/files', {
      params: conversationId ? { conversationId } : undefined,
    });
    return res.data;
  },

  /**
   * 触发下载 — 拿带 Authorization 的 blob，再用 a[download] 触发保存。
   * 避免直接 window.open URL（带不上 token）。
   */
  async download(fileId: string, filename: string): Promise<void> {
    const token = authStorage.getAccessToken();
    const res = await fetch(`${baseURL}/v1/files/${fileId}/download`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!res.ok) {
      throw new Error(`下载失败：HTTP ${res.status}`);
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  },
};
