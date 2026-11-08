import { lazy } from 'react';
import type { FrontendModule } from './types';

export const payrollModule: FrontendModule = {
  key: 'payroll',
  menuId: 12000020,
  routes: [
    { path: '/payroll/periods', element: lazy(() => import('@/pages/payroll/Periods').then((m) => ({ default: m.PeriodsPage }))) },
    { path: '/payroll/components', element: lazy(() => import('@/pages/payroll/Components').then((m) => ({ default: m.ComponentsPage }))) },
    { path: '/payroll/rates/pf', element: lazy(() => import('@/pages/payroll/PfRates').then((m) => ({ default: m.PfRatesPage }))) },
    { path: '/payroll/rates/hra-cca', element: lazy(() => import('@/pages/payroll/HraCcaRates').then((m) => ({ default: m.HraCcaRatesPage }))) },
    { path: '/payroll/rates/da', element: lazy(() => import('@/pages/payroll/DaRates').then((m) => ({ default: m.DaRatesPage }))) },
  ],
};
