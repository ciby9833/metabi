import { api } from '@/lib/api';
import { Conversation, Message } from '@/types';

export interface ChatAttachmentMeta {
  id: string;
  kind: 'image' | 'table' | 'pdf' | 'text';
  filename: string;
  mimeType: string;
  sizeBytes: number;
  preview: any;
}

export const chatService = {
  // send() 已删 — 唯一通路是 SSE：见 services/chat-stream.service.ts

  async uploadAttachment(file: File): Promise<ChatAttachmentMeta> {
    const form = new FormData();
    form.append('file', file);
    const res = await api.post<ChatAttachmentMeta>('/v1/chat/attachments', form, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
    return res.data;
  },

  async getAttachment(id: string): Promise<ChatAttachmentMeta> {
    const res = await api.get<ChatAttachmentMeta>(`/v1/chat/attachments/${id}`);
    return res.data;
  },

  /**
   * 拉附件原始字节 → 返回 blob URL 供 <img>/<embed> 直接展示
   *
   * 走 axios 是因为要带 auth token；<img src> 直接指向 API 拿不到 header
   * 用完记得 URL.revokeObjectURL 释放
   */
  async getAttachmentBlobUrl(id: string): Promise<string> {
    const res = await api.get(`/v1/chat/attachments/${id}/raw`, {
      responseType: 'blob',
    });
    return URL.createObjectURL(res.data as Blob);
  },

  async listConversations(projectId?: string): Promise<Conversation[]> {
    const res = await api.get<Conversation[]>('/v1/chat/conversations', {
      params: projectId ? { project_id: projectId } : undefined,
    });
    return res.data;
  },

  async createConversation(payload: {
    title?: string;
    datasourceId?: string;
    projectId?: string;
  }): Promise<Conversation> {
    const res = await api.post<Conversation>('/v1/chat/conversations', payload);
    return res.data;
  },

  /** 移到项目 / 移出项目 / 改标题 */
  async updateConversation(
    id: string,
    dto: { projectId?: string | null; title?: string },
  ): Promise<Conversation> {
    const res = await api.patch<Conversation>(`/v1/chat/conversations/${id}`, dto);
    return res.data;
  },

  async getHistory(
    conversationId: string,
  ): Promise<{ conversation: Conversation; messages: Message[] }> {
    const res = await api.get<{ conversation: Conversation; messages: Message[] }>(
      `/v1/chat/conversations/${conversationId}/history`,
    );
    return res.data;
  },

  async deleteConversation(id: string): Promise<void> {
    await api.delete(`/v1/chat/conversations/${id}`);
  },

  async submitFeedback(
    messageId: string,
    payload: {
      type: 'good' | 'bad';
      notes?: string;
      saveAsTemplate?: boolean;
      templatePriority?: number;
    },
  ): Promise<void> {
    await api.post(`/v1/chat/messages/${messageId}/feedback`, payload);
  },
};
