import { Router } from 'express';
import { ModuleIds } from '../models/auth';
import { AppError } from '../lib/errors';
import type { AppModule } from './types';

/**
 * EPF Trust — reserved extension point (ARDB D6).
 * Inputs available today: payroll.pf_contribution_events (written when a pay bill is marked PAID)
 * and payroll.payroll_pf_deduction_rates. Planned surface: /api/epf/ledger, /interest-runs,
 * /withdrawals, /statements. Enable by adding "epf" to MODULES_ENABLED once implemented.
 */
export const epfModule: AppModule = {
  key: 'epf',
  title: 'EPF Trust',
  menuId: ModuleIds.EPF,
  headOfficeOnly: true,
  buildRouter: () =>
    Router().all('*', (_req, _res, next) => next(AppError.notImplemented('EPF Trust module is not yet implemented'))),
};
