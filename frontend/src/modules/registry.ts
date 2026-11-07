import { epfModule } from './epf';
import { hrModule } from './hr';
import { payrollModule } from './payroll';
import type { FrontendModule } from './types';

export const MODULES: FrontendModule[] = [hrModule, payrollModule, epfModule];
export const moduleRoutes = MODULES.flatMap((m) => m.routes);
