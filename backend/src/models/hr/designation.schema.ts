import { z } from 'zod';

const blankToUndef = (v: unknown) => (typeof v === 'string' && v.trim() === '' ? undefined : v);

export const DesignationInputSchema = z.object({
  designationName: z.string().trim().min(1, 'Designation name is required').max(150),
  grade: z.preprocess(blankToUndef, z.string().trim().max(50).optional()),
  payLevel: z.preprocess(blankToUndef, z.string().trim().max(50).optional()),
  seniorityOrder: z.preprocess(blankToUndef, z.coerce.number().int().min(1).max(999).optional()),
  isActive: z.boolean().optional(),
});
export type DesignationInput = z.infer<typeof DesignationInputSchema>;

export const DesignationQuerySchema = z.object({
  search: z.string().trim().optional(),
  includeInactive: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => v === 'true'),
});
export type DesignationQuery = z.infer<typeof DesignationQuerySchema>;

export const IdParamSchema = z.object({ id: z.coerce.number().int().positive() });
