import { describe, expect, it } from 'vitest';
import { PeriodInputSchema } from '../src/models/payroll/period.schema';

const ok = { payrollType: 'SALARY', month: 11, calendarYear: 2026, fromDate: '2026-11-01', toDate: '2026-11-30', branchId: 1, daRate: 53 };
const errs = (patch: object) => {
  const r = PeriodInputSchema.safeParse({ ...ok, ...patch });
  return r.success ? {} : r.error.flatten().fieldErrors;
};

describe('PeriodInputSchema', () => {
  it('accepts a full SALARY month', () => expect(PeriodInputSchema.parse(ok).daRate).toBe(53));
  it('to-date before from-date', () => expect(errs({ toDate: '2026-10-31' })).toHaveProperty('toDate'));
  it('SALARY month/year must match from-date', () => {
    expect(errs({ month: 10 })).toHaveProperty('fromDate');
    expect(errs({ calendarYear: 2025 })).toHaveProperty('fromDate');
  });
  it('non-SALARY types may differ (e.g. DA arrears paid in November for Jul–Oct)', () =>
    expect(errs({ payrollType: 'DA_ARREARS', month: 11, fromDate: '2026-11-01', arrearFromDate: '2026-07-01', arrearToDate: '2026-10-31' })).toEqual({}));
  it('arrear dates: both or neither, in order', () => {
    expect(errs({ payrollType: 'DA_ARREARS', arrearFromDate: '2026-07-01' })).toHaveProperty('arrearToDate');
    expect(errs({ payrollType: 'DA_ARREARS', arrearFromDate: '2026-10-01', arrearToDate: '2026-07-31' })).toHaveProperty('arrearToDate');
  });
  it('rejects bad type, month and DA', () => {
    expect(errs({ payrollType: 'WAGES' })).toHaveProperty('payrollType');
    expect(errs({ month: 13 })).toHaveProperty('month');
    expect(errs({ daRate: 1000 })).toHaveProperty('daRate');
  });
});
