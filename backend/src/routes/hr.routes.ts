import { Router } from 'express';
import * as designations from '../controllers/hr/designationController';
import * as banks from '../controllers/hr/bankMasterController';
import * as employees from '../controllers/hr/employeeController';
import * as leaveTypes from '../controllers/hr/leaveTypeController';
import * as branches from '../controllers/hr/branchController';
import * as attendances from '../controllers/hr/attendanceController';
import { AttendanceImportSchema, AttendanceMonthQuerySchema, AttendanceSaveSchema } from '../models/hr/attendance.schema';
import { BranchInputSchema, BranchQuerySchema } from '../models/hr/branch.schema';
import { LeaveTypeInputSchema, LeaveTypeQuerySchema } from '../models/hr/leaveType.schema';
import { BankInputSchema, BankQuerySchema, SetActiveQuerySchema } from '../models/hr/bankMaster.schema';
import { EmployeeInputSchema, EmployeeQuerySchema } from '../models/hr/employee.schema';
import { asyncHandler as h } from '../lib/asyncHandler';
import { requireRole } from '../middleware/authorize';
import { validate } from '../middleware/validate';
import { Roles } from '../models/auth';
import { DesignationInputSchema, DesignationQuerySchema, IdParamSchema } from '../models/hr/designation.schema';

/**
 * /api/hr — mounted by modules/hr.module.ts behind authenticate + HeadOffice.
 * TNCU role matrix: masters → Admin, HR. Transactions: read Admin/HR/Payroll, write Admin/HR.
 */
const hrMasters = requireRole(Roles.HR);
const hrRead = requireRole(Roles.HR, Roles.Payroll);

export function buildHrRouter(): Router {
  const r = Router();

  r.get('/designations', hrMasters, validate(DesignationQuerySchema, 'query'), h(designations.list));
  r.get('/designations/:id', hrMasters, validate(IdParamSchema, 'params'), h(designations.get));
  r.post('/designations', hrMasters, validate(DesignationInputSchema), h(designations.create));
  r.put('/designations/:id', hrMasters, validate(IdParamSchema, 'params'), validate(DesignationInputSchema), h(designations.update));
  r.delete('/designations/:id', hrMasters, validate(IdParamSchema, 'params'), h(designations.remove));

  // Employees — read Admin/HR/Payroll, write Admin/HR (TNCU matrix)
  r.get('/employees', hrRead, validate(EmployeeQuerySchema, 'query'), h(employees.list));
  r.get('/employees/:id', hrRead, validate(IdParamSchema, 'params'), h(employees.get));
  r.get('/employees/:id/service-history', hrRead, validate(IdParamSchema, 'params'), h(employees.serviceHistory));
  r.post('/employees', hrMasters, validate(EmployeeInputSchema), h(employees.create));
  r.put('/employees/:id', hrMasters, validate(IdParamSchema, 'params'), validate(EmployeeInputSchema), h(employees.update));

  // Bank Master — read HR/Payroll, write HR (TNCU: Admin, HR)
  r.get('/bank-masters', hrRead, validate(BankQuerySchema, 'query'), h(banks.list));
  r.get('/bank-masters/:id', hrRead, validate(IdParamSchema, 'params'), h(banks.get));
  r.post('/bank-masters', hrMasters, validate(BankInputSchema), h(banks.create));
  r.put('/bank-masters/:id', hrMasters, validate(IdParamSchema, 'params'), validate(BankInputSchema), h(banks.update));
  r.delete('/bank-masters/:id/permanent', hrMasters, validate(IdParamSchema, 'params'), h(banks.remove));
  r.delete('/bank-masters/:id', hrMasters, validate(IdParamSchema, 'params'), validate(SetActiveQuerySchema, 'query'), h(banks.setActive));

  // Leave types — TNCU: Admin, HR
  r.get('/leave-types', hrRead, validate(LeaveTypeQuerySchema, 'query'), h(leaveTypes.list));
  r.get('/leave-types/:id', hrRead, validate(IdParamSchema, 'params'), h(leaveTypes.get));
  r.post('/leave-types', hrMasters, validate(LeaveTypeInputSchema), h(leaveTypes.create));
  r.put('/leave-types/:id', hrMasters, validate(IdParamSchema, 'params'), validate(LeaveTypeInputSchema), h(leaveTypes.update));
  r.delete('/leave-types/:id/permanent', hrMasters, validate(IdParamSchema, 'params'), h(leaveTypes.remove));
  r.delete('/leave-types/:id', hrMasters, validate(IdParamSchema, 'params'), validate(SetActiveQuerySchema, 'query'), h(leaveTypes.setActive));

  // Branches (core.branches) — read HR/Payroll, write HR
  r.get('/branches', hrRead, validate(BranchQuerySchema, 'query'), h(branches.list));
  r.get('/branches/:id', hrRead, validate(IdParamSchema, 'params'), h(branches.get));
  r.post('/branches', hrMasters, validate(BranchInputSchema), h(branches.create));
  r.put('/branches/:id', hrMasters, validate(IdParamSchema, 'params'), validate(BranchInputSchema), h(branches.update));
  r.delete('/branches/:id/permanent', hrMasters, validate(IdParamSchema, 'params'), h(branches.remove));
  r.delete('/branches/:id', hrMasters, validate(IdParamSchema, 'params'), validate(SetActiveQuerySchema, 'query'), h(branches.setActive));

  // Daily attendance — read HR/Payroll, write HR (monthly grid + CSV import)
  r.get('/attendances', hrRead, validate(AttendanceMonthQuerySchema, 'query'), h(attendances.month));
  r.put('/attendances', hrMasters, validate(AttendanceSaveSchema), h(attendances.save));
  r.post('/attendances/import', hrMasters, validate(AttendanceImportSchema), h(attendances.importRows));

  // Next steps (see docs/tncu-gams-extraction.md §2):
  // leave-*, increments, transfers, promotions,
  // promotion-panels, retirements, disciplinary-*, suspensions, penalty-orders, reports/*.
  return r;
}
