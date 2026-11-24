import { z } from 'zod';

const blankToUndef = (v: unknown) => (typeof v === 'string' && v.trim() === '' ? undefined : v);

export const GradeInputSchema = z.object({
  gradeCode: z.string({ required_error: 'Grade code is required' }).trim().min(1, 'Grade code is required').max(50, 'At most 50 characters'),
  description: z.preprocess(blankToUndef, z.string().trim().max(150, 'At most 150 characters').nullish()),
  displayOrder: z.preprocess(
    (v) => (blankToUndef(v) === undefined ? null : v),
    z.union([z.null(), z.coerce.number({ invalid_type_error: 'Enter a whole number' }).int('Enter a whole number').min(1, '1–999').max(999, '1–999')]),
  ),
  isActive: z.boolean().optional(),
});
export type GradeInput = z.infer<typeof GradeInputSchema>;

/** `active=true` returns only active grades (designation dropdown); otherwise all. */
export const GradeQuerySchema = z.object({
  active: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => v === 'true'),
});
export type GradeQuery = z.infer<typeof GradeQuerySchema>;
