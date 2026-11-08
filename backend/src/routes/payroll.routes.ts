import { Router } from 'express';
import * as components from '../controllers/payroll/componentController';
import * as daRates from '../controllers/payroll/daRateController';
import * as periods from '../controllers/payroll/periodController';
import { IdParamSchema } from '../models/hr/designation.schema';
import { PeriodInputSchema, PeriodQuerySchema, WorkingDaysSchema } from '../models/payroll/period.schema';
import { validate } from '../middleware/validate';
import { DaRateInputSchema } from '../models/payroll/daRate.schema';
import * as pfRates from '../controllers/payroll/pfRateController';
import * as hraCca from '../controllers/payroll/hraCcaController';
import {
  AffectedQuerySchema,
  AsOnQuerySchema,
  BasisChangeSchema,
  CoverageQuerySchema,
  HraCcaBulkReviseSchema,
  HraCcaRateCreateSchema,
  HraCcaRateQuerySchema,
  HraCcaRateReviseSchema,
  HraCcaRateUpdateSchema,
  ResolveQuerySchema,
} from '../models/payroll/hraCca.schema';
import { PfRateInputSchema } from '../models/payroll/pfRate.schema';
import { asyncHandler as h } from '../lib/asyncHandler';
import { requireRole } from '../middleware/authorize';
import { Roles } from '../models/auth';

/**
 * /api/payroll — TNCU role matrix: read Admin/HR/Payroll, write Admin/Payroll; all HeadOffice.
 */
const read = requireRole(Roles.HR, Roles.Payroll);
const write = requireRole(Roles.Payroll);
/** Organisation settings (spec ORG_SETTINGS_EDIT): Admin only. */
const adminOnly = requireRole();

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

  // HRA & CCA calculation basis — specs/01 §6 (read HR/Payroll, change Admin only)
  r.get('/settings/hra-cca-basis', read, h(hraCca.basisStatus));
  r.put('/settings/hra-cca-basis', adminOnly, validate(BasisChangeSchema), h(hraCca.basisChange));
  r.get('/settings/hra-cca-basis/coverage', read, validate(CoverageQuerySchema, 'query'), h(hraCca.basisCoverage));

  // HRA & CCA rates — read HR/Payroll, write Payroll (Admin always). Static paths before /:id.
  r.get('/rates/hra-cca', read, validate(HraCcaRateQuerySchema, 'query'), h(hraCca.list));
  r.get('/rates/hra-cca/missing', read, validate(AsOnQuerySchema, 'query'), h(hraCca.missing));
  r.get('/rates/hra-cca/affected', read, validate(AffectedQuerySchema, 'query'), h(hraCca.affected));
  r.get('/rates/hra-cca/resolve', read, validate(ResolveQuerySchema, 'query'), h(hraCca.resolve));
  r.post('/rates/hra-cca', write, validate(HraCcaRateCreateSchema), h(hraCca.create));
  r.post('/rates/hra-cca/bulk-revise', write, validate(HraCcaBulkReviseSchema), h(hraCca.bulkRevise));
  r.get('/rates/hra-cca/:id', read, validate(IdParamSchema, 'params'), h(hraCca.get));
  r.put('/rates/hra-cca/:id', write, validate(IdParamSchema, 'params'), validate(HraCcaRateUpdateSchema), h(hraCca.update));
  r.post('/rates/hra-cca/:id/revise', write, validate(IdParamSchema, 'params'), validate(HraCcaRateReviseSchema), h(hraCca.revise));
  r.delete('/rates/hra-cca/:id', write, validate(IdParamSchema, 'params'), h(hraCca.deactivate));

  // Next steps (docs §3): components CRUD, component-assignments, settings,
  // payrolls (compute, preparation, withhold,
  // approve-run, mark-paid), period-attendance, period-deductions, manual-deductions, readiness,
  // reports, payslips, my-payslips, da-arrears, sls, retirement-leave-encashment, neft.
  return r;
}
