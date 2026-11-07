import { describe, expect, it } from 'vitest';
import { PfRateInputSchema } from '../src/models/payroll/pfRate.schema';

describe('PfRateInputSchema (TNCU parity 0–100)', () => {
  it.each([['12', 12], ['10', 10], ['0', 0], ['100', 100], ['12.5', 12.5]])('accepts %s', (v, exp) =>
    expect(PfRateInputSchema.parse({ effectiveFrom: '2026-07-01', pfPercentage: v }).pfPercentage).toBe(exp));
  it.each(['-1', '100.01', '101', '12.345', 'x'])('rejects PF %s', (v) =>
    expect(PfRateInputSchema.safeParse({ effectiveFrom: '2026-07-01', pfPercentage: v }).success).toBe(false));
  it('requires a YYYY-MM-DD date', () => expect(PfRateInputSchema.safeParse({ effectiveFrom: '2026/07/01', pfPercentage: 12 }).success).toBe(false));
});
