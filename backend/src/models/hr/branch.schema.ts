import { z } from 'zod';

/** Blank strings from the form become null so optional columns are cleared, not set to ''. */
const optional = (inner: z.ZodString) =>
  z.preprocess((v) => (typeof v === 'string' ? (v.trim() === '' ? null : v.trim()) : v ?? null), inner.nullable()).optional();

/** Branch master (core.branches). Code is stored uppercase and is unique; exactly one HO exists. */
export const BranchInputSchema = z.object({
  code: z.preprocess(
    (v) => (typeof v === 'string' ? v.trim().toUpperCase() : v),
    z
      .string({ required_error: 'Branch code is required' })
      .min(1, 'Branch code is required')
      .max(16, 'At most 16 characters')
      .regex(/^[A-Z0-9_-]+$/, 'Use letters, digits, - or _ only'),
  ),
  name: z.string({ required_error: 'Branch name is required' }).trim().min(1, 'Branch name is required').max(200, 'At most 200 characters'),
  type: z.enum(['HO', 'BRANCH']).default('BRANCH'),
  address: optional(z.string().max(500, 'At most 500 characters')),
  district: optional(z.string().max(100, 'At most 100 characters')),
  pincode: optional(z.string().regex(/^\d{6}$/, 'Pincode must be 6 digits')),
  phone: optional(z.string().max(20, 'At most 20 characters').regex(/^[0-9+()\- ]+$/, 'Digits, spaces, +, -, ( ) only')),
  email: optional(z.string().max(100, 'At most 100 characters').email('Enter a valid email')),
  placeId: z.preprocess((v) => (v === '' || v === undefined ? null : v), z.coerce.number().int().positive().nullable()).optional(),
  isActive: z.boolean().optional(),
});
export type BranchInput = z.infer<typeof BranchInputSchema>;

export const BranchQuerySchema = z.object({
  search: z.string().trim().max(100).optional(),
  includeInactive: z.enum(['true', 'false']).optional().transform((v) => v === 'true'),
});
export type BranchQuery = z.infer<typeof BranchQuerySchema>;
