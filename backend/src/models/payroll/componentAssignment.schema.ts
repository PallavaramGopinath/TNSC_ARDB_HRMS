import { z } from 'zod';
import { AssignedType } from '../enums';

/** Component assignments: what one employee is paid, or has deducted, under a component (docs §3.1). */
const date = z.string({ required_error: 'Enter a date', invalid_type_error: 'Enter a date' }).regex(/^\d{4}-\d{2}-\d{2}$/, 'Enter a valid date');
const optDate = z.preprocess((v) => (v === '' || v === undefined ? null : v), date.nullable());
const twoDecimals = (v: number) => Math.round(v * 100) === Math.round(v * 100 * 1e6) / 1e6;
const blankAs = (blank: 0 | null) => (v: unknown) => (v === '' || v === undefined || v === null ? blank : v);

const rupees = z.coerce
  .number({ invalid_type_error: 'Enter an amount' })
  .min(0, 'Cannot be negative')
  .max(99_999_999, 'Amount is too large')
  .refine(twoDecimals, 'At most 2 decimals');
const percent = z.coerce
  .number({ invalid_type_error: 'Enter a percentage' })
  .gt(0, 'Enter a percentage above 0, up to 100')
  .max(100, 'Enter a percentage above 0, up to 100')
  .refine(twoDecimals, 'At most 2 decimals');
const id = (msg: string) => z.coerce.number({ invalid_type_error: msg }).int(msg).positive(msg);

const terms = {
  assignedType: z.enum(AssignedType, { errorMap: () => ({ message: 'Select fixed amount or percentage' }) }),
  assignedAmount: z.preprocess(blankAs(null), rupees.nullable()),
  percentage: z.preprocess(blankAs(null), percent.nullable()),
  minimumAmount: z.preprocess(blankAs(0), rupees),
  maximumAmount: z.preprocess(blankAs(0), rupees),
};

interface Terms {
  assignedType: (typeof AssignedType)[number];
  assignedAmount: number | null;
  percentage: number | null;
  minimumAmount: number;
  maximumAmount: number;
}

/** A blank amount or percentage is never taken as 0. Minimum and maximum limit a percentage (0 = no limit). */
const checkTerms = (v: Terms, ctx: z.RefinementCtx) => {
  const issue = (path: string, message: string) => ctx.addIssue({ code: 'custom', path: [path], message });
  if (v.assignedType === 'FIXED') {
    if (v.assignedAmount === null) issue('assignedAmount', 'Enter an amount');
    return;
  }
  if (v.percentage === null) issue('percentage', 'Enter a percentage');
  if (v.maximumAmount > 0 && v.maximumAmount < v.minimumAmount) issue('maximumAmount', 'Maximum must be 0 (no limit) or at least the minimum');
};
const checkRange = (v: { effectiveFrom: string | null; effectiveTo?: string | null }, ctx: z.RefinementCtx) => {
  if (v.effectiveFrom && v.effectiveTo && v.effectiveTo < v.effectiveFrom)
    ctx.addIssue({ code: 'custom', path: ['effectiveTo'], message: 'End date must be on or after start date.' });
};

/** Keep only what the type uses, so the unused figures are always stored as 0. */
const normalise = <T extends Terms>(v: T) => {
  const fixed = v.assignedType === 'FIXED';
  return {
    ...v,
    assignedAmount: fixed ? v.assignedAmount ?? 0 : 0,
    percentage: fixed ? 0 : v.percentage ?? 0,
    minimumAmount: fixed ? 0 : v.minimumAmount,
    maximumAmount: fixed ? 0 : v.maximumAmount,
  };
};

export const AssignmentCreateSchema = z
  .object({
    employeeId: id('Select an employee.'),
    componentId: id('Select a component.'),
    ...terms,
    effectiveFrom: date,
    effectiveTo: optDate.optional(),
  })
  .superRefine(checkTerms)
  .superRefine(checkRange)
  .transform(normalise);
export type AssignmentCreate = z.infer<typeof AssignmentCreateSchema>;

/**
 * Edit: employee and component cannot change (deactivate and add instead). The start may be blank only on a
 * row that has none already (the column allows it); the service checks that.
 */
export const AssignmentUpdateSchema = z
  .object({ ...terms, effectiveFrom: optDate, effectiveTo: optDate.optional() })
  .superRefine(checkTerms)
  .superRefine(checkRange)
  .transform(normalise);
export type AssignmentUpdate = z.infer<typeof AssignmentUpdateSchema>;

/** Revise: a successor row from `effectiveFrom`; the current row is closed the day before. */
export const AssignmentReviseSchema = z
  .object({ ...terms, effectiveFrom: date })
  .superRefine(checkTerms)
  .transform(normalise);
export type AssignmentRevise = z.infer<typeof AssignmentReviseSchema>;

const optId = z.preprocess((v) => (v === '' ? undefined : v), z.coerce.number().int().positive().optional());

export const AssignmentQuerySchema = z.object({
  employeeId: optId,
  componentId: optId,
  status: z.enum(['CURRENT', 'FUTURE', 'EXPIRED', 'INACTIVE', 'ALL']).optional(),
  asOn: date.optional(),
  search: z.string().trim().max(100).optional(),
  page: z.coerce.number().int().min(1).default(1),
  size: z.coerce.number().int().min(1).max(200).default(50),
});
export type AssignmentQuery = z.infer<typeof AssignmentQuerySchema>;
