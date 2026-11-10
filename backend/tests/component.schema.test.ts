import { describe, expect, it } from 'vitest';
import { ComponentInputSchema } from '../src/models/payroll/component.schema';
import { isSystemComponent } from '../src/services/payroll/componentService';

const ok = { componentName: 'Travel Allowance', componentCode: ' ta ', componentType: '1' };

describe('ComponentInputSchema', () => {
  it('uppercases the code, coerces numbers, defaults flags and amounts', () => {
    expect(ComponentInputSchema.parse(ok)).toEqual({
      componentName: 'Travel Allowance', componentCode: 'TA', componentType: 1,
      isDaApplicable: false, isSurrenderLeaveApplicable: false, isIncomeTaxApplicable: false,
      displayOrder: null, minimumAmount: 0, maximumAmount: 0,
    });
  });
  it('keeps a single space in codes like ADL PF and blanks optional text to null', () => {
    const r = ComponentInputSchema.parse({ ...ok, componentCode: 'adl  pf', calculationMethod: ' ', displayOrder: '15' });
    expect(r.componentCode).toBe('ADL PF');
    expect(r.calculationMethod).toBeNull();
    expect(r.displayOrder).toBe(15);
  });
  it.each([
    [{ componentName: ' ' }, 'componentName'],
    [{ componentCode: '' }, 'componentCode'],
    [{ componentCode: 'BAD-CODE' }, 'componentCode'],
    [{ componentCode: 'X'.repeat(21) }, 'componentCode'],
    [{ componentType: 4 }, 'componentType'],
    [{ componentType: '' }, 'componentType'],
    [{ displayOrder: -1 }, 'displayOrder'],
    [{ displayOrder: 1.5 }, 'displayOrder'],
    [{ minimumAmount: -1 }, 'minimumAmount'],
    [{ minimumAmount: 1.234 }, 'minimumAmount'],
    [{ minimumAmount: 500, maximumAmount: 100 }, 'maximumAmount'],
    [{ calculationMethod: 'x'.repeat(51) }, 'calculationMethod'],
  ])('rejects %j', (patch, field) => {
    const r = ComponentInputSchema.safeParse({ ...ok, ...patch });
    expect(r.success).toBe(false);
    expect(Object.keys(r.success ? {} : r.error.flatten().fieldErrors)).toContain(field);
  });
  it('allows max 0 (no limit) with a minimum', () => {
    expect(ComponentInputSchema.parse({ ...ok, minimumAmount: '100', maximumAmount: '0' }).minimumAmount).toBe(100);
  });
});

describe('isSystemComponent', () => {
  it('flags calculator codes only, case-insensitively', () => {
    expect(['BASIC', 'da', 'ADL PF', 'EMPLOYER_PF', 'it'].every(isSystemComponent)).toBe(true);
    expect(isSystemComponent('TA')).toBe(false);
    expect(isSystemComponent(null)).toBe(false);
  });
});
