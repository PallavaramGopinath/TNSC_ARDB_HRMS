import { z } from 'zod';

/** Requests of Payroll Preparation (specs/08-payroll-preparation.md §5, §9). */
const id = z.coerce.number().int().positive();
const flag = z.boolean().default(false);
const blankToNull = (v: unknown) => (typeof v === 'string' && v.trim() === '' ? null : v);
const remarks = z.preprocess(blankToNull, z.string().trim().max(500, 'At most 500 characters').nullable().optional());
const days = z.number().int('Whole days only').min(0, 'Cannot be negative').max(31, 'At most 31');
const money = z.number().min(0, 'Cannot be negative').max(99_999_999.99, 'Too large').multipleOf(0.01, 'At most 2 decimal places');
const cell = z.string().max(200);

export const PeriodParamSchema = z.object({ periodId: id });
/** Pay Bill print: one branch, or all when omitted. */
export const PayBillQuerySchema = z.object({ branchId: id.optional() });
export const PeriodEmployeeParamSchema = z.object({ periodId: id, employeeId: id });

export const PrepareSchema = z.object({ periodId: id, confirmAttendance: flag });
export type PrepareInput = z.infer<typeof PrepareSchema>;

export const ApproveRunSchema = z.object({ periodId: id });

export const ReturnSchema = z.object({ reason: z.string().trim().min(1, 'Enter a reason').max(500, 'At most 500 characters') });

export const WithholdSchema = z.object({
  withheld: z.boolean(),
  reason: z.preprocess(blankToNull, z.string().trim().max(256, 'At most 256 characters').nullable().optional()),
});
export type WithholdInput = z.infer<typeof WithholdSchema>;

// ---- monthly attendance
export const PeriodAttendanceSaveSchema = z.object({
  entries: z
    .array(
      z.object({
        employeeId: id,
        headQuarters: days.default(0),
        camp: days.default(0),
        remarks,
        leaves: z.array(z.object({ leaveTypeId: id, days })).max(100).default([]),
      }),
    )
    .min(1, 'Nothing to save')
    .max(2000),
  confirm: flag,
});
export type PeriodAttendanceSave = z.infer<typeof PeriodAttendanceSaveSchema>;

/** A sheet read in the browser: `headers` are the columns other than the employee code and name. */
export const PeriodAttendanceImportSchema = z.object({
  headers: z.array(cell).min(1, 'The sheet has no HQ, Camp or leave columns').max(100),
  rows: z.array(z.object({ line: z.number().int(), code: cell, values: z.array(cell).max(100) })).min(1, 'The sheet has no rows').max(2000),
  dryRun: z.boolean(),
  confirm: flag,
});
export type PeriodAttendanceImport = z.infer<typeof PeriodAttendanceImportSchema>;

// ---- agency deductions
export const PeriodDeductionSaveSchema = z.object({
  entries: z.array(z.object({ employeeId: id, componentId: id, amount: money.nullable(), remarks })).min(1, 'Nothing to save').max(5000),
  confirm: flag,
});
export type PeriodDeductionSave = z.infer<typeof PeriodDeductionSaveSchema>;

export const PeriodDeductionImportSchema = z.object({
  componentId: id,
  /** Deduction code printed at the top of the template, if the sheet has one. */
  sheetCode: cell.nullable().optional(),
  rows: z.array(z.object({ line: z.number().int(), code: cell, amount: cell })).min(1, 'The sheet has no rows').max(2000),
  dryRun: z.boolean(),
  confirm: flag,
});
export type PeriodDeductionImport = z.infer<typeof PeriodDeductionImportSchema>;

// ---- edit deductions
export const ManualDeductionSaveSchema = z.object({
  entries: z.array(z.object({ componentId: id, amount: money.nullable(), remarks })).max(200),
});
export type ManualDeductionSave = z.infer<typeof ManualDeductionSaveSchema>;
