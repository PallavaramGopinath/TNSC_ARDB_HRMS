import { describe, expect, it } from 'vitest';
import { BranchInputSchema } from '../src/models/hr/branch.schema';

const base = { code: 'CHN01', name: 'Chennai Main' };

describe('BranchInputSchema', () => {
  it('trims and uppercases the code, defaults type to BRANCH', () => {
    const r = BranchInputSchema.parse({ code: ' chn-01 ', name: '  Chennai Main ' });
    expect(r).toMatchObject({ code: 'CHN-01', name: 'Chennai Main', type: 'BRANCH' });
  });
  it.each(['', '   ', 'CH N', 'CH@1', 'X'.repeat(17)])('rejects code %j', (code) =>
    expect(BranchInputSchema.safeParse({ ...base, code }).success).toBe(false));
  it('rejects blank and over-long names', () => {
    expect(BranchInputSchema.safeParse({ ...base, name: '  ' }).success).toBe(false);
    expect(BranchInputSchema.safeParse({ ...base, name: 'x'.repeat(201) }).success).toBe(false);
  });
  it('turns blank optional fields into null', () => {
    const r = BranchInputSchema.parse({ ...base, address: ' ', district: '', pincode: '', phone: '', email: '', placeId: '' });
    expect(r).toMatchObject({ address: null, district: null, pincode: null, phone: null, email: null, placeId: null });
  });
  it.each(['12345', '1234567', 'abcdef'])('rejects pincode %j', (pincode) =>
    expect(BranchInputSchema.safeParse({ ...base, pincode }).success).toBe(false));
  it('validates email and phone', () => {
    expect(BranchInputSchema.safeParse({ ...base, email: 'not-an-email' }).success).toBe(false);
    expect(BranchInputSchema.safeParse({ ...base, phone: 'call me' }).success).toBe(false);
    expect(BranchInputSchema.parse({ ...base, email: 'chn@ardb.in', phone: '+91 44-2345 6789', pincode: '600001', placeId: '2' }))
      .toMatchObject({ email: 'chn@ardb.in', phone: '+91 44-2345 6789', pincode: '600001', placeId: 2 });
  });
  it('rejects an unknown type', () => expect(BranchInputSchema.safeParse({ ...base, type: 'ZONE' }).success).toBe(false));
});
