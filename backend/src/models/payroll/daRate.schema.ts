import { z } from 'zod';

/**
 * TNCU PayrollDaRateSaveRequest: EffectiveFrom required, DaPercentage 0–100.
 * ARDB: upper limit raised to 999.99 (matches numeric(8,2)) for wage settlements with DA above 100%.
 */
export const DaRateInputSchema = z.object({
  effectiveFrom: z.string({ required_error: 'Effective-from date is required' }).regex(/^\d{4}-\d{2}-\d{2}$/, 'Enter a valid date'),
  daPercentage: z.coerce
    .number({ invalid_type_error: 'Enter the DA percentage' })
    .min(0, 'DA cannot be negative')
    .max(999.99, 'DA cannot exceed 999.99%')
    .refine((v) => Math.round(v * 100) === Math.round(v * 100 * 1e6) / 1e6, 'At most 2 decimals'),
});
export type DaRateInput = z.infer<typeof DaRateInputSchema>;
