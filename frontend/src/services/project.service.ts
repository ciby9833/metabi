import { api } from '@/lib/api';

export type ProjectRole = 'owner' | 'admin' | 'editor' | 'viewer';

export interface Project {
  id: string;
  name: string;
  description?: string | null;
  icon?: string | null;
  ownerId: string;
  systemInstructions?: string | null;
  isActive: boolean;
  /** true = 用户的"我的工作区"（系统自动创建，每个用户唯一一个）*/
  isPersonalWorkspace?: boolean;
  createdAt: string;
  updatedAt: string;
  myRole: ProjectRole;
  memberCount?: number;
}

export interface ProjectMember {
  id: string;
  projectId: string;
  userId: string;
  role: ProjectRole;
  createdAt: string;
  user?: {
    id: string;
    name: string;
    email: string;
    avatarUrl?: string | null;
  } | null;
}

export interface CreateProjectInput {
  name: string;
  description?: string;
  icon?: string;
  systemInstructions?: string;
}

export interface UpdateProjectInput {
  name?: string;
  description?: string;
  icon?: string;
  systemInstructions?: string;
  isActive?: boolean;
}

export const projectService = {
  async list(): Promise<Project[]> {
    const res = await api.get<Project[]>('/v1/projects');
    return res.data;
  },
  async get(id: string): Promise<Project> {
    const res = await api.get<Project>(`/v1/projects/${id}`);
    return res.data;
  },
  async create(input: CreateProjectInput): Promise<Project> {
    const res = await api.post<Project>('/v1/projects', input);
    return res.data;
  },
  async update(id: string, input: UpdateProjectInput): Promise<Project> {
    const res = await api.patch<Project>(`/v1/projects/${id}`, input);
    return res.data;
  },
  async remove(id: string): Promise<void> {
    await api.delete(`/v1/projects/${id}`);
  },
  // members
  async listMembers(projectId: string): Promise<ProjectMember[]> {
    const res = await api.get<ProjectMember[]>(`/v1/projects/${projectId}/members`);
    return res.data;
  },
  async invite(
    projectId: string,
    email: string,
    role: 'admin' | 'editor' | 'viewer',
  ): Promise<ProjectMember> {
    const res = await api.post<ProjectMember>(`/v1/projects/${projectId}/members`, { email, role });
    return res.data;
  },
  async updateMemberRole(
    projectId: string,
    memberId: string,
    role: 'admin' | 'editor' | 'viewer',
  ): Promise<ProjectMember> {
    const res = await api.patch<ProjectMember>(
      `/v1/projects/${projectId}/members/${memberId}`,
      { role },
    );
    return res.data;
  },
  async removeMember(projectId: string, memberId: string): Promise<void> {
    await api.delete(`/v1/projects/${projectId}/members/${memberId}`);
  },
  async leave(projectId: string): Promise<void> {
    await api.post(`/v1/projects/${projectId}/leave`);
  },
};
