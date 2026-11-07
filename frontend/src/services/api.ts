import axios, { AxiosError, type InternalAxiosRequestConfig } from 'axios';
import type { ApiErrorBody, TokenPair } from '@/types/api';
import { tokenStore } from './tokenStore';

export const api = axios.create({ baseURL: '/api' });

api.interceptors.request.use((cfg) => {
  const t = tokenStore.get();
  if (t) cfg.headers.Authorization = `Bearer ${t.accessToken}`;
  return cfg;
});

// Single-flight refresh on 401, then replay the original request once.
let refreshing: Promise<TokenPair | null> | null = null;
const listeners = new Set<(p: TokenPair | null) => void>();
export const onAuthChange = (fn: (p: TokenPair | null) => void) => {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
};
const emit = (p: TokenPair | null) => listeners.forEach((l) => l(p));

async function doRefresh(): Promise<TokenPair | null> {
  const current = tokenStore.get();
  if (!current?.refreshToken) return null;
  try {
    const { data } = await axios.post<TokenPair>('/api/auth/refresh', { refreshToken: current.refreshToken });
    tokenStore.set(data);
    emit(data);
    return data;
  } catch {
    tokenStore.clear();
    emit(null);
    return null;
  }
}

api.interceptors.response.use(undefined, async (error: AxiosError) => {
  const original = error.config as (InternalAxiosRequestConfig & { _retried?: boolean }) | undefined;
  if (error.response?.status === 401 && original && !original._retried && !original.url?.startsWith('/auth/')) {
    original._retried = true;
    refreshing ??= doRefresh().finally(() => (refreshing = null));
    const next = await refreshing;
    if (next) {
      original.headers.Authorization = `Bearer ${next.accessToken}`;
      return api(original);
    }
  }
  return Promise.reject(error);
});

/** Human-readable message from an API error. */
export function errorMessage(e: unknown): string {
  const ax = e as AxiosError<ApiErrorBody>;
  const body = ax.response?.data?.error;
  if (body?.details && typeof body.details === 'object' && body.code === 'VALIDATION') {
    const first = Object.entries(body.details as Record<string, string[]>)[0];
    if (first) return `${first[0]}: ${first[1][0]}`;
  }
  return body?.message ?? ax.message ?? 'Something went wrong';
}

/** Field-level validation errors from a 400 VALIDATION response ({ field: [messages] }), if any. */
export function fieldErrors(e: unknown): Record<string, string[]> | null {
  const body = (e as AxiosError<ApiErrorBody>).response?.data?.error;
  return body?.code === 'VALIDATION' && body.details && typeof body.details === 'object' ? (body.details as Record<string, string[]>) : null;
}
