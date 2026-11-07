import { z } from 'zod';

/** TNCU PayrollPfDeductionRateSaveRequest: EffectiveFrom required, PfDeductionPercentage 0–100. */
export const PfRateInputSchema = z.object({
  effectiveFrom: z.string({ required_error: 'Effective-from date is required' }).regex(/^\d{4}-\d{2}-\d{2}$/, 'Enter a valid date'),
  pfPercentage: z.coerce
    .number({ invalid_type_error: 'Enter the PF percentage' })
    .min(0, 'PF cannot be negative')
    .max(100, 'PF cannot exceed 100%')
    .refine((v) => Math.round(v * 100) === Math.round(v * 100 * 1e6) / 1e6, 'At most 2 decimals'),
});
export type PfRateInput = z.infer<typeof PfRateInputSchema>;
