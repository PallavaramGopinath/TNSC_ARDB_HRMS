import { api } from './api';
import type { MenuMain } from '@/types/api';

export const menuApi = {
  tree: () => api.get<MenuMain[]>('/core/menu').then((r) => r.data),
  context: () => api.get<{ businessDate: string; modules: { key: string; title: string; menuId: number }[] }>('/core/context').then((r) => r.data),
};
