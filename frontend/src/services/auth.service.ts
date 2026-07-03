import { api } from '@/lib/api';
import { authStorage, StoredUser } from '@/lib/auth-storage';

export interface Providers {
  password: boolean;
  register: boolean;
  google: boolean;
  feishu: boolean;
  requireEmailCode: boolean;
}

export interface AuthResult {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  user: StoredUser;
}

export interface MeResponse extends StoredUser {
  lastLoginAt?: string | null;
  createdAt?: string;
  hasPassword: boolean;
  /** 部门（如"财务部"）— 给 LLM 软上下文用 */
  department?: string | null;
  /** 职能角色（如"分析师"）*/
  jobRole?: string | null;
}

export interface OAuthBinding {
  provider: 'google' | 'feishu';
  providerEmail?: string | null;
  providerName?: string | null;
  connectedAt: string;
}

export const authService = {
  async getProviders(): Promise<Providers> {
    const res = await api.get<Providers>('/v1/auth/providers');
    return res.data;
  },

  async sendEmailCode(
    email: string,
    purpose: 'register' | 'reset_password' | 'change_email',
  ): Promise<{ ttlSeconds: number; devCode?: string }> {
    const res = await api.post('/v1/auth/email-code', { email, purpose });
    return res.data;
  },

  async register(input: {
    email: string;
    password: string;
    name: string;
    code?: string;
  }): Promise<AuthResult> {
    const res = await api.post<AuthResult>('/v1/auth/register', input);
    this.persistAuth(res.data);
    return res.data;
  },

  async login(email: string, password: string): Promise<AuthResult> {
    const res = await api.post<AuthResult>('/v1/auth/login', { email, password });
    this.persistAuth(res.data);
    return res.data;
  },

  async forgotPassword(email: string): Promise<{ ttlSeconds: number; devCode?: string }> {
    const res = await api.post('/v1/auth/forgot-password', { email });
    return res.data;
  },

  async resetPassword(email: string, code: string, newPassword: string): Promise<void> {
    await api.post('/v1/auth/reset-password', { email, code, newPassword });
  },

  async changePassword(oldPassword: string, newPassword: string): Promise<void> {
    await api.post('/v1/auth/change-password', { oldPassword, newPassword });
  },

  async me(): Promise<MeResponse> {
    const res = await api.get<MeResponse>('/v1/auth/me');
    // sync 本地缓存
    authStorage.setUser({
      id: res.data.id,
      email: res.data.email,
      name: res.data.name,
      avatarUrl: res.data.avatarUrl,
      isAdmin: res.data.isAdmin,
      emailVerified: res.data.emailVerified,
    });
    return res.data;
  },

  async updateProfile(dto: {
    name?: string;
    avatarUrl?: string;
    department?: string;
    jobRole?: string;
  }): Promise<MeResponse> {
    const res = await api.patch<MeResponse>('/v1/auth/me', dto);
    return res.data;
  },

  async logout() {
    try {
      await api.post('/v1/auth/logout');
    } catch {
      // 后端可能挂了；本地清理即可
    }
    authStorage.clear();
  },

  // ============ OAuth ============

  async getOAuthAuthorizeUrl(provider: 'google' | 'feishu'): Promise<string> {
    const state = Math.random().toString(36).slice(2);
    sessionStorage.setItem('chatbi_oauth_state', state);
    const res = await api.get<{ url: string }>(`/v1/auth/oauth/${provider}/url`, {
      params: { state },
    });
    return res.data.url;
  },

  async handleOAuthCallback(
    provider: 'google' | 'feishu',
    code: string,
  ): Promise<AuthResult> {
    const res = await api.post<AuthResult>(`/v1/auth/oauth/${provider}/callback`, { code });
    this.persistAuth(res.data);
    return res.data;
  },

  async listBindings(): Promise<OAuthBinding[]> {
    const res = await api.get<OAuthBinding[]>('/v1/auth/oauth/bindings');
    return res.data;
  },

  async unbind(provider: 'google' | 'feishu'): Promise<void> {
    await api.delete(`/v1/auth/oauth/bindings/${provider}`);
  },

  // ============ helpers ============

  persistAuth(r: AuthResult) {
    authStorage.setTokens(r.accessToken, r.refreshToken);
    authStorage.setUser(r.user);
  },
};
