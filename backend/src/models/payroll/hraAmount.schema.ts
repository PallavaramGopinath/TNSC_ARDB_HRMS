import { z } from 'zod';

/** Fixed HRA amounts per designation — specs/06 §5, §12.1. */
const date = z.string({ required_error: 'Enter a date' }).regex(/^\d{4}-\d{2}-\d{2}$/, 'Enter a valid date');
const optDate = z.preprocess((v) => (v === '' || v === undefined ? null : v), date.nullable());

/** Required: a blank amount must not be taken as 0. An explicit 0 is allowed (no HRA). */
const amount = z.preprocess(
  (v) => (v === '' || v === null ? undefined : v),
  z.coerce
    .number({ required_error: 'Enter an amount', invalid_type_error: 'Enter an amount' })
    .int('Enter whole rupees')
    .min(0, 'Cannot be negative')
    .max(99_999_999, 'Amount is too large'),
);
const id = z.coerce.number({ invalid_type_error: 'Select a designation.' }).int().positive('Select a designation.');

const values = {
  gccAmount: amount,
  otherAmount: amount,
  effectiveFrom: date,
  remarks: z.preprocess((v) => (v === '' ? null : v), z.string().trim().max(500, 'At most 500 characters').nullable().optional()),
};
const checkRange = (v: { effectiveFrom: string; effectiveTo?: string | null }, ctx: z.RefinementCtx) => {
  if (v.effectiveTo && v.effectiveTo < v.effectiveFrom)
    ctx.addIssue({ code: 'custom', path: ['effectiveTo'], message: 'End date must be on or after start date.' });
};

export const HraAmountCreateSchema = z.object({ designationId: id, ...values, effectiveTo: optDate.optional() }).superRefine(checkRange);
export type HraAmountCreate = z.infer<typeof HraAmountCreateSchema>;

/** Edit: the designation cannot change (deactivate and add instead). */
export const HraAmountUpdateSchema = z.object({ ...values, effectiveTo: optDate.optional() }).superRefine(checkRange);
export type HraAmountUpdate = z.infer<typeof HraAmountUpdateSchema>;

/** Revise: a successor row from `effectiveFrom`; the current row is closed the day before. */
export const HraAmountReviseSchema = z.object(values);
export type HraAmountRevise = z.infer<typeof HraAmountReviseSchema>;

export const HraAmountQuerySchema = z.object({
  designationId: z.preprocess((v) => (v === '' ? undefined : v), z.coerce.number().int().positive().optional()),
  status: z.enum(['CURRENT', 'FUTURE', 'EXPIRED', 'INACTIVE', 'ALL']).optional(),
  asOn: date.optional(),
  search: z.string().trim().max(100).optional(),
});
export type HraAmountQuery = z.infer<typeof HraAmountQuerySchema>;
