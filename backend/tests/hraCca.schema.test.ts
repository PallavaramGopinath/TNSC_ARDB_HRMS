import { describe, expect, it } from 'vitest';
import { HraCcaBulkReviseSchema, HraCcaRateCreateSchema, HraCcaRateQuerySchema, HraCcaRateUpdateSchema } from '../src/models/payroll/hraCca.schema';

const ok = { designationId: 4, effectiveFrom: '2026-04-01', hraPercent: '8', ccaPercent: '3' };

describe('HraCcaRateCreateSchema (spec §5.3)', () => {
  it('accepts a designation rate, defaulting caps to 0 and blank end/remarks to null', () => {
    const v = HraCcaRateCreateSchema.parse({ ...ok, effectiveTo: '', remarks: '' });
    expect(v).toMatchObject({ designationId: 4, hraPercent: 8, ccaPercent: 3, hraMinAmount: 0, hraMaxAmount: 0, effectiveTo: null, remarks: null });
  });
  it('requires exactly one key (spec §6)', () => {
    expect(HraCcaRateCreateSchema.safeParse({ ...ok, placeId: 1 }).success).toBe(false);
    expect(HraCcaRateCreateSchema.safeParse({ ...ok, designationId: undefined }).success).toBe(false);
    expect(HraCcaRateCreateSchema.safeParse({ ...ok, designationId: undefined, placeId: 2 }).success).toBe(true);
  });
  it.each(['-1', '100.01', '8.125', 'abc'])('rejects HRA %% %s', (v) => expect(HraCcaRateCreateSchema.safeParse({ ...ok, hraPercent: v }).success).toBe(false));
  it.each(['0', '100', '7.5', '10.25'])('accepts CCA %% %s', (v) => expect(HraCcaRateCreateSchema.safeParse({ ...ok, ccaPercent: v }).success).toBe(true));
  it('rejects an end date before the start', () => {
    const r = HraCcaRateCreateSchema.safeParse({ ...ok, effectiveTo: '2026-03-31' });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues[0]!.message).toBe('End date must be on or after start date.');
  });
  it('allows max 0 (no cap) but not a max below the min', () => {
    expect(HraCcaRateCreateSchema.safeParse({ ...ok, hraMinAmount: 500, hraMaxAmount: 0 }).success).toBe(true);
    expect(HraCcaRateCreateSchema.safeParse({ ...ok, ccaMinAmount: 500, ccaMaxAmount: 400 }).success).toBe(false);
  });
});

describe('HraCcaRateUpdateSchema', () => {
  it('ignores a key in the body (key cannot change on edit)', () =>
    expect(HraCcaRateUpdateSchema.parse({ ...ok, placeId: 9 })).not.toHaveProperty('placeId'));
});

describe('HraCcaBulkReviseSchema (spec §5.5)', () => {
  it('needs at least one item', () => expect(HraCcaBulkReviseSchema.safeParse({ effectiveFrom: '2027-04-01', items: [] }).success).toBe(false));
  it('validates each item', () => {
    expect(HraCcaBulkReviseSchema.safeParse({ effectiveFrom: '2027-04-01', items: [{ keyId: 1, hraPercent: 9, ccaPercent: 3 }] }).success).toBe(true);
    expect(HraCcaBulkReviseSchema.safeParse({ effectiveFrom: '2027-04-01', items: [{ keyId: 1, hraPercent: 101, ccaPercent: 3 }] }).success).toBe(false);
  });
});

describe('HraCcaRateQuerySchema', () => {
  it('defaults paging and coerces ids', () =>
    expect(HraCcaRateQuerySchema.parse({ designationId: '3' })).toMatchObject({ designationId: 3, page: 1, size: 25 }));
  it('rejects an unknown basis', () => expect(HraCcaRateQuerySchema.safeParse({ basis: 'BRANCH' }).success).toBe(false));
});
