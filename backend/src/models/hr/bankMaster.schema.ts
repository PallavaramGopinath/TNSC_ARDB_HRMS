import { z } from 'zod';

/** TNCU BankValidation: name ≤150; IFSC prefix exactly 4 letters, stored uppercase. */
export const BankInputSchema = z.object({
  bankName: z.string().trim().min(1, 'Bank name is required').max(150, 'At most 150 characters'),
  ifscForBank: z.preprocess(
    (v) => (typeof v === 'string' ? v.trim().toUpperCase() : v),
    z.string({ required_error: 'IFSC prefix is required' }).regex(/^[A-Z]{4}$/, 'IFSC prefix must be exactly 4 letters, e.g. SBIN'),
  ),
  isActive: z.boolean().optional(),
});
export type BankInput = z.infer<typeof BankInputSchema>;

export const BankQuerySchema = z.object({
  search: z.string().trim().max(100).optional(),
  includeInactive: z.enum(['true', 'false']).optional().transform((v) => v === 'true'),
});
export type BankQuery = z.infer<typeof BankQuerySchema>;

export const SetActiveQuerySchema = z.object({
  isActive: z.enum(['true', 'false'], { required_error: 'isActive=true|false is required' }).transform((v) => v === 'true'),
});
