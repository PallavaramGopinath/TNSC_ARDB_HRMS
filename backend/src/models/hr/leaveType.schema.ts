import { z } from 'zod';

const twoDp = (v: number) => Math.round(v * 100) === v * 100;

/** TNCU EmployeeLeaveTypeSaveRequest: name ≤100, code ≤20 (uppercased), quota 0–365, pay-cut 0–1. */
export const LeaveTypeInputSchema = z.object({
  leaveName: z.string().trim().min(1, 'Leave name is required').max(100, 'At most 100 characters'),
  leaveCode: z.preprocess(
    (v) => (typeof v === 'string' ? v.trim().toUpperCase() : v),
    z.string({ required_error: 'Leave code is required' }).regex(/^[A-Z0-9_]{1,20}$/, 'Code: 1–20 letters, digits or _'),
  ),
  annualQuota: z.coerce.number({ invalid_type_error: 'Enter a number' }).min(0, '0–365 days').max(365, '0–365 days').refine(twoDp, 'At most 2 decimals'),
  payCutFactor: z.coerce.number({ invalid_type_error: 'Enter a number' }).min(0, 'Between 0 and 1').max(1, 'Between 0 and 1').refine(twoDp, 'At most 2 decimals'),
  carryForward: z.boolean().default(false),
  encashmentAllowed: z.boolean().default(false),
  cutsSpecialPayAndDa: z.boolean().default(false),
  affectsLeaveBalance: z.boolean().default(false),
  isActive: z.boolean().optional(),
});
export type LeaveTypeInput = z.infer<typeof LeaveTypeInputSchema>;

export const LeaveTypeQuerySchema = z.object({
  includeInactive: z.enum(['true', 'false']).optional().transform((v) => v === 'true'),
});
export type LeaveTypeQuery = z.infer<typeof LeaveTypeQuerySchema>;
