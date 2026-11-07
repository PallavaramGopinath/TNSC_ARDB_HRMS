import { Router } from 'express';
import { env } from '../config/env';
import { authenticate, requirePasswordChanged } from '../middleware/auth';
import { requireHeadOffice } from '../middleware/authorize';
import { epfModule } from './epf.module';
import { hrModule } from './hr.module';
import { payrollModule } from './payroll.module';
import type { AppModule } from './types';

/** All known modules. Order = mount order. */
export const MODULES: AppModule[] = [hrModule, payrollModule, epfModule];

export const enabledModules = (): AppModule[] => MODULES.filter((m) => env.MODULES_ENABLED.includes(m.key));

/** Mounts each enabled module at /<key> behind authentication (+ HeadOffice policy where required). */
export function mountModules(api: Router): void {
  for (const m of enabledModules()) {
    const guards = [authenticate, requirePasswordChanged, ...(m.headOfficeOnly ? [requireHeadOffice] : [])];
    api.use(`/${m.key}`, ...guards, m.buildRouter());
  }
}
