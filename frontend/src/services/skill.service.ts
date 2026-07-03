import { api } from '@/lib/api';

export type SkillVisibility = 'global' | 'project' | 'personal';

export interface SkillSummary {
  name: string;
  version: string;
  description: string;
  match?: string | null;
  priority: number;
  tables?: string[] | null;
  attributableDimensions?: string[] | null;
  datasourceTypes?: string[] | null;
  bodyPreview: string;
  isActive: boolean;
  source: 'seed' | 'user';
  hasRollback: boolean;
  rowVersion: number;
  updatedAt: string;
  updatedBy?: string | null;
  /** 可见性（'global' / 'project' / 'personal'）*/
  visibility: SkillVisibility;
  /** visibility='project' 时关联的 project */
  projectId?: string | null;
  /** visibility='personal' 时的 owner */
  ownerUserId?: string | null;
}

export interface SkillDetail extends Omit<SkillSummary, 'bodyPreview'> {
  body: string;
  createdAt: string;
}

export interface SkillUpsert {
  name: string;
  version?: string;
  description: string;
  match?: string;
  priority?: number;
  tables?: string[];
  attributableDimensions?: string[];
  datasourceTypes?: string[];
  body: string;
  isActive?: boolean;
  visibility?: SkillVisibility;
  projectId?: string | null;
}

export interface SkillUpdate extends Partial<SkillUpsert> {
  rowVersion: number;
}

export const skillService = {
  async list(includeInactive = false): Promise<SkillSummary[]> {
    const res = await api.get<SkillSummary[]>('/v1/skills', {
      params: includeInactive ? { include_inactive: 'true' } : undefined,
    });
    return res.data;
  },
  async getOne(name: string): Promise<SkillDetail> {
    const res = await api.get<SkillDetail>(`/v1/skills/${encodeURIComponent(name)}`);
    return res.data;
  },
  async create(dto: SkillUpsert): Promise<SkillDetail> {
    const res = await api.post<SkillDetail>('/v1/skills', dto);
    return res.data;
  },
  async update(name: string, dto: SkillUpdate): Promise<SkillDetail> {
    const res = await api.patch<SkillDetail>(`/v1/skills/${encodeURIComponent(name)}`, dto);
    return res.data;
  },
  async rollback(name: string): Promise<SkillDetail> {
    const res = await api.post<SkillDetail>(`/v1/skills/${encodeURIComponent(name)}/rollback`);
    return res.data;
  },
  async deactivate(name: string): Promise<void> {
    await api.post(`/v1/skills/${encodeURIComponent(name)}/deactivate`);
  },
  async hardDelete(name: string): Promise<void> {
    await api.delete(`/v1/skills/${encodeURIComponent(name)}`);
  },
  async reload(): Promise<{ count: number }> {
    const res = await api.post<{ count: number }>('/v1/skills/reload');
    return res.data;
  },
};
