import axios, { AxiosError, AxiosInstance, AxiosRequestConfig } from 'axios';
import { authStorage } from './auth-storage';

const baseURL = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:3000/api';

export const api: AxiosInstance = axios.create({
  baseURL,
  timeout: 120_000,
  headers: { 'Content-Type': 'application/json' },
});

// 请求拦截器：自动加 Bearer
api.interceptors.request.use((config) => {
  const token = authStorage.getAccessToken();
  if (token) {
    config.headers = config.headers || ({} as any);
    (config.headers as any).Authorization = `Bearer ${token}`;
  }
  return config;
});

// 401 自动 refresh，失败跳登录
let refreshing: Promise<string | null> | null = null;

async function tryRefresh(): Promise<string | null> {
  if (refreshing) return refreshing;
  const refreshToken = authStorage.getRefreshToken();
  if (!refreshToken) return null;
  refreshing = axios
    .post(
      `${baseURL}/v1/auth/refresh`,
      { refreshToken },
      { timeout: 10000, headers: { 'Content-Type': 'application/json' } },
    )
    .then((res) => {
      const { accessToken, refreshToken: newRefresh } = res.data || {};
      if (!accessToken) return null;
      authStorage.setTokens(accessToken, newRefresh || refreshToken);
      return accessToken;
    })
    .catch(() => null)
    .finally(() => {
      refreshing = null;
    });
  return refreshing;
}

api.interceptors.response.use(
  (response) => response,
  async (error: AxiosError<{ message?: string; statusCode?: number }>) => {
    const status = error.response?.status;
    const original = error.config as AxiosRequestConfig & { _retried?: boolean };

    // 401 → 尝试 refresh，仅一次。/v1/auth/* 系列接口除外（避免死循环）
    if (
      status === 401 &&
      original &&
      !original._retried &&
      !original.url?.includes('/v1/auth/')
    ) {
      original._retried = true;
      const newAccess = await tryRefresh();
      if (newAccess) {
        original.headers = original.headers || ({} as any);
        (original.headers as any).Authorization = `Bearer ${newAccess}`;
        return api.request(original);
      }
      // refresh 失败 → 清登录态 + 跳登录
      authStorage.clear();
      if (typeof window !== 'undefined' && !window.location.pathname.startsWith('/auth/')) {
        const next = encodeURIComponent(window.location.pathname + window.location.search);
        window.location.href = `/auth/login?next=${next}`;
      }
    }

    const detail =
      error.response?.data?.message ||
      (error.response?.data as any)?.detail ||
      error.message ||
      'Network error';
    const composed = new Error(`[${status || 'NET'}] ${detail}`);
    (composed as any).status = status;
    (composed as any).raw = error.response?.data;
    return Promise.reject(composed);
  },
);

export type ApiError = Error & { status?: number; raw?: unknown };
