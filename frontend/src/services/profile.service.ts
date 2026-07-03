/**
 * User Profile (Memory) SDK
 *
 * 注意：此处的 "profile" ≠ auth me/profile。
 * auth profile = 账户基础资料（name/avatar/dept/role）
 * 这里 profile = Memory（AI 学习的偏好 + 用户可编辑的风格）
 */
import { api } from '@/lib/api';

export interface StyleMemory {
  verbosity?: 'concise' | 'normal' | 'detailed';
  numberFormat?: 'absolute' | 'kw' | 'auto';
  preferredLanguage?: 'zh-CN' | 'en' | 'auto';
  preferredChartType?: 'auto' | 'bar' | 'line' | 'pie' | 'table';
}

export interface ContentMemory {
  oneLinerSummary?: string;
  interestTopics?: string[];
  knownTerms?: string[];
  questionPatterns?: string[];
  defaultDateRange?: string;
}

export interface ProfileResponse {
  styleMemory: StyleMemory;
  contentMemory: ContentMemory;
  lastRefinedAt: string | null;
  refinedThroughConvCount: number;
}

export const profileService = {
  async get(): Promise<ProfileResponse> {
    const res = await api.get<ProfileResponse>('/v1/profile/preferences');
    return res.data;
  },

  async patchStyle(patch: Partial<StyleMemory>): Promise<{ styleMemory: StyleMemory }> {
    const res = await api.patch<{ styleMemory: StyleMemory }>(
      '/v1/profile/preferences/style',
      patch,
    );
    return res.data;
  },

  async patchContent(patch: Partial<ContentMemory>): Promise<{ contentMemory: ContentMemory }> {
    const res = await api.patch<{ contentMemory: ContentMemory }>(
      '/v1/profile/preferences/content',
      patch,
    );
    return res.data;
  },

  async reset(): Promise<ProfileResponse> {
    const res = await api.delete<ProfileResponse>('/v1/profile/preferences');
    return res.data;
  },

  async refineNow(): Promise<{ contentMemory: ContentMemory; lastRefinedAt: string }> {
    const res = await api.post<{ contentMemory: ContentMemory; lastRefinedAt: string }>(
      '/v1/profile/preferences/refine',
      {},
    );
    return res.data;
  },
};
