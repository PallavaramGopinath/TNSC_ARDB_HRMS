import { z } from 'zod';
import { AttendanceStatus } from '../enums';

export type AttendanceStatusValue = (typeof AttendanceStatus)[number];

/** Short codes accepted from CSV files and the grid (TNCU import: P / A / L / H / HD). */
const ALIASES: Record<string, AttendanceStatusValue> = {
  P: 'PRESENT',
  A: 'ABSENT',
  L: 'LEAVE',
  H: 'HOLIDAY',
  HD: 'HALF_DAY',
  HALFDAY: 'HALF_DAY',
  'HALF DAY': 'HALF_DAY',
};

/** 'p', 'Present', 'half day' → canonical status; anything else is returned unchanged (and fails the enum). */
export function normaliseStatus(v: unknown): unknown {
  if (typeof v !== 'string') return v;
  const s = v.trim().toUpperCase();
  return ALIASES[s] ?? s.replace(/[\s-]+/g, '_');
}

const isRealDate = (s: string) => {
  const [y, m, d] = s.split('-').map(Number) as [number, number, number];
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
};

export const IsoDate = z
  .string({ required_error: 'Date is required' })
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD')
  .refine(isRealDate, 'Not a valid calendar date');

const Status = z.preprocess(normaliseStatus, z.enum(AttendanceStatus, { errorMap: () => ({ message: 'Status must be P, A, L, H or HD' }) }));

export const AttendanceMonthQuerySchema = z.object({
  branchId: z.coerce.number().int().positive(),
  year: z.coerce.number().int().min(2000).max(2100),
  month: z.coerce.number().int().min(1).max(12),
});
export type AttendanceMonthQuery = z.infer<typeof AttendanceMonthQuerySchema>;

export const AttendanceSaveSchema = z.object({
  branchId: z.coerce.number().int().positive(),
  entries: z
    .array(
      z.object({
        employeeId: z.coerce.number().int().positive(),
        date: IsoDate,
        /** null clears the day. */
        status: Status.nullable(),
        remarks: z.string().trim().max(500).optional().nullable(),
      }),
    )
    .min(1, 'Nothing to save')
    .max(3000, 'At most 3,000 changes per save'),
});
export type AttendanceSaveInput = z.infer<typeof AttendanceSaveSchema>;

export const AttendanceImportSchema = z.object({
  dryRun: z.boolean().default(true),
  rows: z
    .array(
      z.object({
        line: z.number().int().positive(),
        code: z.string().trim().max(50),
        date: z.string().trim().max(20),
        status: z.string().trim().max(20),
      }),
    )
    .min(1, 'The file has no rows')
    .max(5000, 'At most 5,000 rows per import'),
});
export type AttendanceImportInput = z.infer<typeof AttendanceImportSchema>;

/** Row-level parse for the import: returns the canonical status, or null if unrecognised. */
export function parseImportStatus(v: string): AttendanceStatusValue | null {
  const r = Status.safeParse(v);
  return r.success ? r.data : null;
}
