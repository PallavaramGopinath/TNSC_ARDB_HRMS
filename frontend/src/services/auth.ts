import { api } from './api';
import type { AuthUser, TokenPair } from '@/types/api';

export const authApi = {
  captcha: () => api.get<{ enabled: boolean; captchaId?: string; svg?: string }>('/auth/captcha').then((r) => r.data),
  login: (body: { username: string; password: string; captchaId?: string; captchaAnswer?: string }) =>
    api.post<TokenPair>('/auth/login', body).then((r) => r.data),
  logout: (refreshToken?: string) => api.post('/auth/logout', { refreshToken }),
  me: () => api.get<AuthUser>('/auth/me').then((r) => r.data),
  changePassword: (body: { currentPassword: string; newPassword: string }) =>
    api.post<TokenPair>('/auth/change-password', body).then((r) => r.data),
};
