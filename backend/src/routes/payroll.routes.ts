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
import * as hraAmounts from '../controllers/payroll/hraAmountController';
import { HraAmountCreateSchema, HraAmountQuerySchema, HraAmountReviseSchema, HraAmountUpdateSchema } from '../models/payroll/hraAmount.schema';
import * as assignments from '../controllers/payroll/componentAssignmentController';
import { AssignmentCreateSchema, AssignmentQuerySchema, AssignmentReviseSchema, AssignmentUpdateSchema } from '../models/payroll/componentAssignment.schema';
import { PfRateInputSchema } from '../models/payroll/pfRate.schema';
import { ComponentInputSchema, ComponentQuerySchema } from '../models/payroll/component.schema';
import { SetActiveQuerySchema } from '../models/hr/bankMaster.schema';
import * as prep from '../controllers/payroll/preparationController';
import {
  ApproveRunSchema,
  ManualDeductionSaveSchema,
  PeriodAttendanceImportSchema,
  PeriodAttendanceSaveSchema,
  PeriodDeductionImportSchema,
  PeriodDeductionSaveSchema,
  PeriodEmployeeParamSchema,
  PeriodParamSchema,
  PrepareSchema,
  ReturnSchema,
  WithholdSchema,
} from '../models/payroll/preparation.schema';
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
  // Payroll components (pay heads) — read HR/Payroll, write Payroll (Admin always)
  r.get('/components', read, validate(ComponentQuerySchema, 'query'), h(components.list));
  r.get('/components/:id', read, validate(IdParamSchema, 'params'), h(components.get));
  r.post('/components', write, validate(ComponentInputSchema), h(components.create));
  r.put('/components/:id', write, validate(IdParamSchema, 'params'), validate(ComponentInputSchema), h(components.update));
  r.delete('/components/:id/permanent', write, validate(IdParamSchema, 'params'), h(components.remove));
  r.delete('/components/:id', write, validate(IdParamSchema, 'params'), validate(SetActiveQuerySchema, 'query'), h(components.setActive));

  // Component assignments — docs §3.1 (read HR/Payroll, write Payroll, Admin always)
  r.get('/component-assignments', read, validate(AssignmentQuerySchema, 'query'), h(assignments.list));
  r.post('/component-assignments', write, validate(AssignmentCreateSchema), h(assignments.create));
  r.get('/component-assignments/:id', read, validate(IdParamSchema, 'params'), h(assignments.get));
  r.put('/component-assignments/:id', write, validate(IdParamSchema, 'params'), validate(AssignmentUpdateSchema), h(assignments.update));
  r.post('/component-assignments/:id/revise', write, validate(IdParamSchema, 'params'), validate(AssignmentReviseSchema), h(assignments.revise));
  r.delete('/component-assignments/:id', write, validate(IdParamSchema, 'params'), h(assignments.deactivate));

  // Periods — guarded flow: no manual status transitions (Prepare/Approve move the status). Static paths before /:id.
  r.post('/periods/resolve-active', write, h(prep.resolveActive));
  r.get('/periods', read, validate(PeriodQuerySchema, 'query'), h(periods.list));
  r.get('/periods/:id', read, validate(IdParamSchema, 'params'), h(periods.get));
  r.post('/periods', write, validate(PeriodInputSchema), h(periods.create));
  r.put('/periods/:id', write, validate(IdParamSchema, 'params'), validate(PeriodInputSchema), h(periods.update));
  r.delete('/periods/:id', write, validate(IdParamSchema, 'params'), h(periods.remove));
  r.put('/periods/:id/working-days', write, validate(IdParamSchema, 'params'), validate(WorkingDaysSchema), h(periods.workingDays));
  r.post('/periods/:id/lock-and-roll', write, validate(IdParamSchema, 'params'), h(periods.lockAndRoll));

  // Allowance preview (DA, HRA, CCA, MA) — specs/06; read-only
  r.get('/periods/:id/allowances', read, validate(IdParamSchema, 'params'), h(periods.allowances));

  // DA rates — read Admin/HR/Payroll, add Admin/Payroll (TNCU PayrollDaRatesController)
  r.get('/rates/da', read, h(daRates.list));
  r.get('/rates/da/active', read, h(daRates.active));
  r.post('/rates/da', write, validate(DaRateInputSchema), h(daRates.create));

  // PF deduction rates — same rules (TNCU PayrollPfDeductionRatesController)
  r.get('/rates/pf', read, h(pfRates.list));
  r.get('/rates/pf/active', read, h(pfRates.active));
  r.post('/rates/pf', write, validate(PfRateInputSchema), h(pfRates.create));

  // HRA method — specs/01 §6, specs/06 §12 (read HR/Payroll, change Admin only)
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

  // Fixed HRA amounts — specs/06 §12.1 (read HR/Payroll, write Payroll). Static paths before /:id.
  r.get('/rates/hra-amounts', read, validate(HraAmountQuerySchema, 'query'), h(hraAmounts.list));
  r.get('/rates/hra-amounts/missing', read, validate(AsOnQuerySchema, 'query'), h(hraAmounts.missing));
  r.post('/rates/hra-amounts', write, validate(HraAmountCreateSchema), h(hraAmounts.create));
  r.get('/rates/hra-amounts/:id', read, validate(IdParamSchema, 'params'), h(hraAmounts.get));
  r.put('/rates/hra-amounts/:id', write, validate(IdParamSchema, 'params'), validate(HraAmountUpdateSchema), h(hraAmounts.update));
  r.post('/rates/hra-amounts/:id/revise', write, validate(IdParamSchema, 'params'), validate(HraAmountReviseSchema), h(hraAmounts.revise));
  r.delete('/rates/hra-amounts/:id', write, validate(IdParamSchema, 'params'), h(hraAmounts.deactivate));

  // Payroll Preparation — specs/08 §11.1 (read HR/Payroll, write Payroll; reversing an approval is Admin only)
  r.post('/periods/:id/reject', write, validate(IdParamSchema, 'params'), validate(ReturnSchema), h(prep.reject));
  r.post('/periods/:id/reverse-approval', adminOnly, validate(IdParamSchema, 'params'), validate(ReturnSchema), h(prep.reverse));
  r.get('/readiness/:periodId', read, validate(PeriodParamSchema, 'params'), h(prep.readiness));
  r.post('/payrolls/compute', write, validate(PrepareSchema), h(prep.prepare));
  r.post('/payrolls/approve-run', write, validate(ApproveRunSchema), h(prep.approve));
  r.get('/payrolls/preparation/:periodId', read, validate(PeriodParamSchema, 'params'), h(prep.grid));
  r.get('/payrolls/:id', read, validate(IdParamSchema, 'params'), h(prep.bill));
  r.put('/payrolls/:id/withhold', write, validate(IdParamSchema, 'params'), validate(WithholdSchema), h(prep.withhold));

  r.get('/period-attendance/:periodId', read, validate(PeriodParamSchema, 'params'), h(prep.attendanceGet));
  r.put('/period-attendance/:periodId', write, validate(PeriodParamSchema, 'params'), validate(PeriodAttendanceSaveSchema), h(prep.attendanceSave));
  r.post('/period-attendance/:periodId/import', write, validate(PeriodParamSchema, 'params'), validate(PeriodAttendanceImportSchema), h(prep.attendanceImport));

  r.get('/period-deductions/:periodId', read, validate(PeriodParamSchema, 'params'), h(prep.deductionsGet));
  r.put('/period-deductions/:periodId', write, validate(PeriodParamSchema, 'params'), validate(PeriodDeductionSaveSchema), h(prep.deductionsSave));
  r.post('/period-deductions/:periodId/import', write, validate(PeriodParamSchema, 'params'), validate(PeriodDeductionImportSchema), h(prep.deductionsImport));

  r.get('/manual-deductions/:periodId/:employeeId', read, validate(PeriodEmployeeParamSchema, 'params'), h(prep.manualGet));
  r.put('/manual-deductions/:periodId/:employeeId', write, validate(PeriodEmployeeParamSchema, 'params'), validate(ManualDeductionSaveSchema), h(prep.manualSave));

  // Next steps (docs §3): settings, mark-paid, reports, payslips, my-payslips, da-arrears, sls,
  // retirement-leave-encashment, neft.
  // Anything that prints employees must order by payrollPrintOrder (services/payroll/printOrder.ts).
  return r;
}
