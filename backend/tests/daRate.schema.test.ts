import { describe, expect, it } from 'vitest';
import { DaRateInputSchema } from '../src/models/payroll/daRate.schema';

describe('DaRateInputSchema', () => {
  it.each([['0', 0], ['53', 53], ['120.5', 120.5], ['999.99', 999.99], ['46.25', 46.25]])('accepts %s', (v, exp) =>
    expect(DaRateInputSchema.parse({ effectiveFrom: '2026-07-01', daPercentage: v }).daPercentage).toBe(exp));
  it.each(['-1', '1000', '12.345', 'abc'])('rejects DA %s', (v) =>
    expect(DaRateInputSchema.safeParse({ effectiveFrom: '2026-07-01', daPercentage: v }).success).toBe(false));
  it('requires a YYYY-MM-DD date', () => {
    expect(DaRateInputSchema.safeParse({ effectiveFrom: '01-07-2026', daPercentage: 50 }).success).toBe(false);
    expect(DaRateInputSchema.safeParse({ daPercentage: 50 }).success).toBe(false);
  });
});
