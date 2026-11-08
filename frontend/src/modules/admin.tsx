import { lazy } from 'react';
import type { FrontendModule } from './types';

export const adminModule: FrontendModule = {
  key: 'admin',
  menuId: 11000000,
  routes: [
    { path: '/admin/settings', element: lazy(() => import('@/pages/admin/RuleSettings').then((m) => ({ default: m.RuleSettingsPage }))) },
  ],
};
