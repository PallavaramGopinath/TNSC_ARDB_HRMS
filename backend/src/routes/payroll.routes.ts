import { Router } from 'express';
import * as components from '../controllers/payroll/componentController';
import * as daRates from '../controllers/payroll/daRateController';
import * as periods from '../controllers/payroll/periodController';
import { IdParamSchema } from '../models/hr/designation.schema';
import { PeriodInputSchema, PeriodQuerySchema, WorkingDaysSchema } from '../models/payroll/period.schema';
import { validate } from '../middleware/validate';
import { DaRateInputSchema } from '../models/payroll/daRate.schema';
import * as pfRates from '../controllers/payroll/pfRateController';
import { PfRateInputSchema } from '../models/payroll/pfRate.schema';
import { asyncHandler as h } from '../lib/asyncHandler';
import { requireRole } from '../middleware/authorize';
import { Roles } from '../models/auth';

/**
 * /api/payroll — TNCU role matrix: read Admin/HR/Payroll, write Admin/Payroll; all HeadOffice.
 */
const read = requireRole(Roles.HR, Roles.Payroll);
const write = requireRole(Roles.Payroll);

export function buildPayrollRouter(): Router {
  const r = Router();
  r.get('/components', read, h(components.list));

  // Periods — guarded flow: no manual status transitions (Prepare/Approve move the status)
  r.get('/periods', read, validate(PeriodQuerySchema, 'query'), h(periods.list));
  r.get('/periods/:id', read, validate(IdParamSchema, 'params'), h(periods.get));
  r.post('/periods', write, validate(PeriodInputSchema), h(periods.create));
  r.put('/periods/:id', write, validate(IdParamSchema, 'params'), validate(PeriodInputSchema), h(periods.update));
  r.delete('/periods/:id', write, validate(IdParamSchema, 'params'), h(periods.remove));
  r.put('/periods/:id/working-days', write, validate(IdParamSchema, 'params'), validate(WorkingDaysSchema), h(periods.workingDays));
  r.post('/periods/:id/lock-and-roll', write, validate(IdParamSchema, 'params'), h(periods.lockAndRoll));

  // DA rates — read Admin/HR/Payroll, add Admin/Payroll (TNCU PayrollDaRatesController)
  r.get('/rates/da', read, h(daRates.list));
  r.get('/rates/da/active', read, h(daRates.active));
  r.post('/rates/da', write, validate(DaRateInputSchema), h(daRates.create));

  // PF deduction rates — same rules (TNCU PayrollPfDeductionRatesController)
  r.get('/rates/pf', read, h(pfRates.list));
  r.get('/rates/pf/active', read, h(pfRates.active));
  r.post('/rates/pf', write, validate(PfRateInputSchema), h(pfRates.create));

  // Next steps (docs §3): components CRUD, component-assignments, rates/hra-cca, settings,
  // payrolls (compute, preparation, withhold,
  // approve-run, mark-paid), period-attendance, period-deductions, manual-deductions, readiness,
  // reports, payslips, my-payslips, da-arrears, sls, retirement-leave-encashment, neft.
  return r;
}
