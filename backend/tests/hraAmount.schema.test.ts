import { describe, expect, it } from 'vitest';
import { HraAmountCreateSchema, HraAmountReviseSchema, HraAmountUpdateSchema } from '../src/models/payroll/hraAmount.schema';

const ok = { designationId: 4, gccAmount: '4000', otherAmount: '3500', effectiveFrom: '2022-01-01' };

describe('HRA amount schemas (spec 06 §12.1)', () => {
  it('accepts amounts, with blank end and remarks as null', () =>
    expect(HraAmountCreateSchema.parse({ ...ok, effectiveTo: '', remarks: '' })).toMatchObject({ designationId: 4, gccAmount: 4000, otherAmount: 3500, effectiveTo: null, remarks: null }));
  it.each(['', null, undefined, 'abc', '-1', '3500.50'])('rejects amount %s (a blank is never 0)', (v) =>
    expect(HraAmountCreateSchema.safeParse({ ...ok, otherAmount: v }).success).toBe(false));
  it('accepts an explicit 0', () => expect(HraAmountReviseSchema.safeParse({ ...ok, gccAmount: 0, otherAmount: 0 }).success).toBe(true));
  it('needs a designation on create and ignores it on edit', () => {
    expect(HraAmountCreateSchema.safeParse({ ...ok, designationId: '' }).success).toBe(false);
    expect(HraAmountUpdateSchema.parse(ok)).not.toHaveProperty('designationId');
  });
  it('rejects an end date before the start', () => expect(HraAmountUpdateSchema.safeParse({ ...ok, effectiveTo: '2021-12-31' }).success).toBe(false));
});
