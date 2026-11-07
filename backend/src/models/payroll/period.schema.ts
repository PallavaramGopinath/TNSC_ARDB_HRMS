import { z } from 'zod';
import { PayrollPeriodStatus, PayrollType } from '../enums';

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Enter a valid date');
const optDate = z.preprocess((v) => (v === '' || v === undefined ? null : v), date.nullable()).optional();

/** TNCU PayrollPeriodSaveRequest + ARDB checks (month/year match the dates for SALARY; arrear range). */
export const PeriodInputSchema = z
  .object({
    payrollType: z.enum(PayrollType, { errorMap: () => ({ message: 'Choose a payroll type' }) }),
    month: z.coerce.number().int().min(1, 'Month 1–12').max(12, 'Month 1–12'),
    calendarYear: z.coerce.number().int().min(2000, 'Enter a valid year').max(2100, 'Enter a valid year'),
    fromDate: date,
    toDate: date,
    branchId: z.coerce.number().int().positive('Choose a branch'),
    daRate: z.coerce.number().min(0, 'Cannot be negative').max(999.99, 'At most 999.99').default(0),
    arrearFromDate: optDate,
    arrearToDate: optDate,
  })
  .superRefine((v, ctx) => {
    if (v.toDate < v.fromDate) ctx.addIssue({ code: 'custom', path: ['toDate'], message: 'To date cannot be before from date' });
    if (v.payrollType === 'SALARY') {
      const [y, m] = v.fromDate.split('-').map(Number);
      if (y !== v.calendarYear || m !== v.month)
        ctx.addIssue({ code: 'custom', path: ['fromDate'], message: 'A SALARY period must start in its own month and year' });
    }
    if (v.arrearFromDate && v.arrearToDate && v.arrearToDate < v.arrearFromDate)
      ctx.addIssue({ code: 'custom', path: ['arrearToDate'], message: 'Arrear to-date cannot be before arrear from-date' });
    if ((v.arrearFromDate == null) !== (v.arrearToDate == null))
      ctx.addIssue({ code: 'custom', path: [v.arrearFromDate ? 'arrearToDate' : 'arrearFromDate'], message: 'Enter both arrear dates or neither' });
  });
export type PeriodInput = z.infer<typeof PeriodInputSchema>;

export const PeriodQuerySchema = z.object({
  status: z.enum(PayrollPeriodStatus).optional(),
  payrollType: z.enum(PayrollType).optional(),
  calendarYear: z.coerce.number().int().optional(),
  month: z.coerce.number().int().min(1).max(12).optional(),
});
export type PeriodQuery = z.infer<typeof PeriodQuerySchema>;

export const WorkingDaysSchema = z.object({
  workingDays: z.preprocess((v) => (v === '' || v === undefined ? null : v), z.coerce.number().int('Whole days only').min(0, 'Cannot be negative').nullable()),
});
