import { describe, expect, it } from 'vitest';
import { BankInputSchema, SetActiveQuerySchema } from '../src/models/hr/bankMaster.schema';

describe('BankInputSchema (TNCU BankValidation)', () => {
  it('trims the name and uppercases the prefix', () => {
    expect(BankInputSchema.parse({ bankName: '  State Bank of India ', ifscForBank: ' sbin ' })).toEqual({ bankName: 'State Bank of India', ifscForBank: 'SBIN' });
  });
  it.each(['SBI', 'SBIN0', 'SB1N', '', '1234'])('rejects prefix %j', (p) =>
    expect(BankInputSchema.safeParse({ bankName: 'X', ifscForBank: p }).success).toBe(false));
  it('rejects blank and over-long names', () => {
    expect(BankInputSchema.safeParse({ bankName: '   ', ifscForBank: 'SBIN' }).success).toBe(false);
    expect(BankInputSchema.safeParse({ bankName: 'x'.repeat(151), ifscForBank: 'SBIN' }).success).toBe(false);
  });
});

describe('SetActiveQuerySchema', () => {
  it('parses true/false and requires a value', () => {
    expect(SetActiveQuerySchema.parse({ isActive: 'false' }).isActive).toBe(false);
    expect(SetActiveQuerySchema.safeParse({}).success).toBe(false);
  });
});
