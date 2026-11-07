import { buildPayrollRouter } from '../routes/payroll.routes';
import { ModuleIds } from '../models/auth';
import type { AppModule } from './types';

export const payrollModule: AppModule = {
  key: 'payroll',
  title: 'Payroll',
  menuId: ModuleIds.Payroll,
  headOfficeOnly: true,
  buildRouter: buildPayrollRouter,
};
