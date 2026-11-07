import { buildHrRouter } from '../routes/hr.routes';
import { ModuleIds } from '../models/auth';
import type { AppModule } from './types';

export const hrModule: AppModule = {
  key: 'hr',
  title: 'HR',
  menuId: ModuleIds.HR,
  headOfficeOnly: true,
  buildRouter: buildHrRouter,
};
