import { lazy } from 'react';
import type { FrontendModule } from './types';

const page = <K extends string>(load: () => Promise<Record<K, React.ComponentType>>, name: K) =>
  lazy(() => load().then((m) => ({ default: m[name] })));

export const hrModule: FrontendModule = {
  key: 'hr',
  menuId: 12000010,
  routes: [
    { path: '/hr/designations', element: page(() => import('@/pages/hr/Designations'), 'DesignationsPage') },
    { path: '/hr/bank-masters', element: page(() => import('@/pages/hr/BankMasters'), 'BankMastersPage') },
    { path: '/hr/branches', element: page(() => import('@/pages/hr/Branches'), 'BranchesPage') },
    { path: '/hr/leave-types', element: page(() => import('@/pages/hr/LeaveTypes'), 'LeaveTypesPage') },
    { path: '/hr/employees', element: page(() => import('@/pages/hr/Employees'), 'EmployeesPage') },
    { path: '/hr/employees/new', element: page(() => import('@/pages/hr/EmployeeForm'), 'EmployeeFormPage') },
    { path: '/hr/employees/:id', element: page(() => import('@/pages/hr/EmployeeProfile'), 'EmployeeProfilePage') },
    { path: '/hr/employees/:id/edit', element: page(() => import('@/pages/hr/EmployeeForm'), 'EmployeeFormPage') },
  ],
};
