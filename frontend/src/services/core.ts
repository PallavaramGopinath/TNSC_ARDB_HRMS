import { api } from './api';
import type { Branch, PlaceCategory } from '@/types/api';

export const coreApi = {
  branches: () => api.get<Branch[]>('/core/branches').then((r) => r.data),
  placeCategories: () => api.get<PlaceCategory[]>('/core/place-categories').then((r) => r.data),
};
