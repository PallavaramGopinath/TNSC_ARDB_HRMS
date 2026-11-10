import { z } from 'zod';

const twoDp = (v: number) => Math.round(v * 100) === Math.round(v * 100 * 1e6) / 1e6;
const optText = (max: number) =>
  z.preprocess((v) => (typeof v === 'string' && v.trim() === '' ? null : typeof v === 'string' ? v.trim() : v), z.string().max(max, `At most ${max} characters`).nullable().optional());
const amount = z.coerce.number({ invalid_type_error: 'Enter an amount' }).min(0, 'Cannot be negative').max(99999999999999.99, 'Too large').refine(twoDp, 'At most 2 decimals');

/**
 * Payroll component (pay head) — TNCU PayrollComponentSaveRequest: name ≤100, code ≤20 (uppercased),
 * type 1 Earnings / 2 Deductions / 3 Loan deductions. Space is allowed in the code for the existing 'ADL PF'.
 * Min/max amounts: 0 means no limit; when both are set, max must be ≥ min.
 */
export const ComponentInputSchema = z
  .object({
    componentName: z.string({ required_error: 'Component name is required' }).trim().min(1, 'Component name is required').max(100, 'At most 100 characters'),
    componentCode: z.preprocess(
      (v) => (typeof v === 'string' ? v.trim().replace(/\s+/g, ' ').toUpperCase() : v),
      z.string({ required_error: 'Component code is required' }).regex(/^[A-Z0-9_ ]{1,20}$/, 'Code: 1–20 letters, digits, _ or space'),
    ),
    componentType: z.preprocess(
      (v) => (typeof v === 'string' && v.trim() !== '' ? Number(v) : v),
      z.union([z.literal(1), z.literal(2), z.literal(3)], { errorMap: () => ({ message: 'Select a type' }) }),
    ),
    isDaApplicable: z.boolean().default(false),
    isSurrenderLeaveApplicable: z.boolean().default(false),
    isIncomeTaxApplicable: z.boolean().default(false),
    displayOrder: z.preprocess(
      (v) => (v === '' || v === undefined ? null : v),
      z.coerce.number({ invalid_type_error: 'Enter a whole number' }).int('Enter a whole number').min(0, 'Cannot be negative').max(99999, 'At most 99999').nullable(),
    ),
    calculationMethod: optText(50),
    calculationBasis: optText(255),
    minimumAmount: amount.default(0),
    maximumAmount: amount.default(0),
    isActive: z.boolean().optional(),
  })
  .refine((v) => v.maximumAmount === 0 || v.maximumAmount >= v.minimumAmount, { path: ['maximumAmount'], message: 'Maximum must be ≥ minimum (0 = no limit)' });
export type ComponentInput = z.infer<typeof ComponentInputSchema>;

export const ComponentQuerySchema = z.object({
  includeInactive: z.enum(['true', 'false']).optional().transform((v) => v === 'true'),
});
export type ComponentQuery = z.infer<typeof ComponentQuerySchema>;
