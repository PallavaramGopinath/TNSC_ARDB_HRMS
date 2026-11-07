import { lazy } from 'react';
import type { FrontendModule } from './types';

/** EPF Trust — extension point. Routes render only once the server menu exposes them. */
export const epfModule: FrontendModule = {
  key: 'epf',
  menuId: 12000040,
  routes: [{ path: '/epf', element: lazy(() => import('@/pages/epf/EpfPlaceholder').then((m) => ({ default: m.EpfPlaceholderPage }))) }],
};
