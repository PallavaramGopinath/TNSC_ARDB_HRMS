import { z } from 'zod';

/** HRA & CCA rates and calculation basis — spec §5.3 validation, §6 API. */
const date = z.string({ required_error: 'Enter a date' }).regex(/^\d{4}-\d{2}-\d{2}$/, 'Enter a valid date');
const optDate = z.preprocess((v) => (v === '' || v === undefined ? null : v), date.nullable());
const twoDecimals = (v: number) => Math.round(v * 100) === Math.round(v * 100 * 1e6) / 1e6;

const percent = z.coerce
  .number({ invalid_type_error: 'Enter a value between 0 and 100.' })
  .min(0, 'Enter a value between 0 and 100.')
  .max(100, 'Enter a value between 0 and 100.')
  .refine(twoDecimals, 'At most 2 decimals');

const amount = z.preprocess(
  (v) => (v === '' || v === undefined || v === null ? 0 : v),
  z.coerce
    .number({ invalid_type_error: 'Enter an amount' })
    .min(0, 'Cannot be negative')
    .max(99_999_999, 'Amount is too large')
    .refine(twoDecimals, 'At most 2 decimals'),
);

const optId = z.preprocess((v) => (v === '' || v === null ? undefined : v), z.coerce.number().int().positive().optional());

export const HraCcaBasisSchema = z.enum(['PLACE', 'DESIGNATION'], { errorMap: () => ({ message: 'Choose PLACE or DESIGNATION' }) });

/** The values every rate row carries (create, edit, revise, bulk item). */
const rateValues = {
  hraPercent: percent,
  hraMinAmount: amount,
  hraMaxAmount: amount,
  ccaPercent: percent,
  ccaMinAmount: amount,
  ccaMaxAmount: amount,
  remarks: z.preprocess((v) => (v === '' ? null : v), z.string().trim().max(500, 'At most 500 characters').nullable().optional()),
};

type Caps = { hraMinAmount: number; hraMaxAmount: number; ccaMinAmount: number; ccaMaxAmount: number };
const checkCaps = (v: Caps, ctx: z.RefinementCtx) => {
  if (v.hraMaxAmount > 0 && v.hraMaxAmount < v.hraMinAmount)
    ctx.addIssue({ code: 'custom', path: ['hraMaxAmount'], message: 'Maximum must be 0 (no cap) or at least the minimum' });
  if (v.ccaMaxAmount > 0 && v.ccaMaxAmount < v.ccaMinAmount)
    ctx.addIssue({ code: 'custom', path: ['ccaMaxAmount'], message: 'Maximum must be 0 (no cap) or at least the minimum' });
};
const checkRange = (v: { effectiveFrom: string; effectiveTo?: string | null }, ctx: z.RefinementCtx) => {
  if (v.effectiveTo && v.effectiveTo < v.effectiveFrom)
    ctx.addIssue({ code: 'custom', path: ['effectiveTo'], message: 'End date must be on or after start date.' });
};

/** Create: exactly one key; which one must match the active basis (checked in the service → 400). */
export const HraCcaRateCreateSchema = z
  .object({
    placeId: optId,
    designationId: optId,
    effectiveFrom: date,
    effectiveTo: optDate.optional(),
    ...rateValues,
  })
  .superRefine((v, ctx) => {
    if ((v.placeId == null) === (v.designationId == null))
      ctx.addIssue({ code: 'custom', path: [v.placeId == null ? 'designationId' : 'placeId'], message: 'Send exactly one of placeId or designationId' });
    checkCaps(v, ctx);
    checkRange(v, ctx);
  });
export type HraCcaRateCreate = z.infer<typeof HraCcaRateCreateSchema>;

/** Edit: the key cannot change (deactivate and add instead). */
export const HraCcaRateUpdateSchema = z
  .object({ effectiveFrom: date, effectiveTo: optDate.optional(), ...rateValues })
  .superRefine((v, ctx) => {
    checkCaps(v, ctx);
    checkRange(v, ctx);
  });
export type HraCcaRateUpdate = z.infer<typeof HraCcaRateUpdateSchema>;

/** Revise: a successor row from `effectiveFrom`; the current row is closed the day before. */
export const HraCcaRateReviseSchema = z
  .object({ effectiveFrom: date, ...rateValues })
  .superRefine((v, ctx) => checkCaps(v, ctx));
export type HraCcaRateRevise = z.infer<typeof HraCcaRateReviseSchema>;

export const HraCcaBulkReviseSchema = z.object({
  effectiveFrom: date,
  remarks: rateValues.remarks,
  items: z
    .array(
      z.object({ keyId: z.coerce.number().int().positive(), ...rateValues }).superRefine((v, ctx) => checkCaps(v, ctx)),
    )
    .min(1, 'Change at least one rate')
    .max(1000),
});
export type HraCcaBulkRevise = z.infer<typeof HraCcaBulkReviseSchema>;

export const HraCcaRateQuerySchema = z.object({
  basis: HraCcaBasisSchema.optional(),
  placeId: optId,
  designationId: optId,
  status: z.enum(['CURRENT', 'FUTURE', 'EXPIRED', 'INACTIVE', 'ALL']).optional(),
  asOn: date.optional(),
  search: z.string().trim().max(100).optional(),
  page: z.coerce.number().int().min(1).default(1),
  size: z.coerce.number().int().min(1).max(200).default(25),
});
export type HraCcaRateQuery = z.infer<typeof HraCcaRateQuerySchema>;

export const AsOnQuerySchema = z.object({ asOn: date.optional() });
export const CoverageQuerySchema = z.object({ basis: HraCcaBasisSchema, asOn: date.optional() });
export const AffectedQuerySchema = z.object({ placeId: optId, designationId: optId });
export const ResolveQuerySchema = z.object({ employeeId: z.coerce.number().int().positive(), asOn: date.optional() });
export const BasisChangeSchema = z.object({ basis: HraCcaBasisSchema });
