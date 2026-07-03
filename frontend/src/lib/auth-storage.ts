/**
 * Token / 用户态持久化（localStorage）
 *
 * 字段：
 *   chatbi_access_token
 *   chatbi_refresh_token
 *   chatbi_user (JSON)
 */
export interface StoredUser {
  id: string;
  email: string;
  name: string;
  avatarUrl?: string | null;
  isAdmin: boolean;
  emailVerified: boolean;
}

const KEY_ACCESS = 'chatbi_access_token';
const KEY_REFRESH = 'chatbi_refresh_token';
const KEY_USER = 'chatbi_user';

const ssr = () => typeof window === 'undefined';

export const authStorage = {
  setTokens(accessToken: string, refreshToken: string) {
    if (ssr()) return;
    localStorage.setItem(KEY_ACCESS, accessToken);
    localStorage.setItem(KEY_REFRESH, refreshToken);
  },
  setUser(user: StoredUser) {
    if (ssr()) return;
    localStorage.setItem(KEY_USER, JSON.stringify(user));
  },
  getAccessToken(): string | null {
    if (ssr()) return null;
    return localStorage.getItem(KEY_ACCESS);
  },
  getRefreshToken(): string | null {
    if (ssr()) return null;
    return localStorage.getItem(KEY_REFRESH);
  },
  getUser(): StoredUser | null {
    if (ssr()) return null;
    const raw = localStorage.getItem(KEY_USER);
    if (!raw) return null;
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  },
  isAuthenticated(): boolean {
    return !!this.getAccessToken();
  },
  clear() {
    if (ssr()) return;
    localStorage.removeItem(KEY_ACCESS);
    localStorage.removeItem(KEY_REFRESH);
    localStorage.removeItem(KEY_USER);
  },
};
