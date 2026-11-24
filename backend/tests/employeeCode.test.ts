/** Employee code input (spec 05): blank → generated; typed → digits only, max 20; an unchanged code always passes. */
import { describe, expect, it } from 'vitest';
import { EmployeeInputSchema } from '../src/models/hr/employee.schema';
import { employeeCodeError } from '../src/services/hr/employeeRules';

const parse = (employeeCode: unknown) =>
  EmployeeInputSchema.safeParse({ employeeName: 'R. Kumar', designationId: 1, branchId: 1, dateOfJoining: '2020-06-01', incrementMonth: 7, employeeCode });

describe('EmployeeInputSchema employeeCode', () => {
  it('blank becomes null; missing stays absent', () => {
    expect(parse('').data?.employeeCode).toBeNull();
    expect(parse('   ').data?.employeeCode).toBeNull();
    expect(parse(undefined).success).toBe(true);
  });
  it('trims and keeps leading zeros', () => expect(parse(' 0001 ').data?.employeeCode).toBe('0001'));
  it('accepts a generated code, so editing such an employee works', () => expect(parse('EMP001').data?.employeeCode).toBe('EMP001'));
  it('limits the length to 20', () => {
    expect(parse('1'.repeat(20)).success).toBe(true);
    expect(parse('1'.repeat(21)).success).toBe(false);
  });
});

describe('employeeCodeError', () => {
  it.each([null, undefined, '', '0001', '1'.repeat(20)])('accepts %s', (c) => expect(employeeCodeError(c)).toBeNull());
  it.each(['EMP001', '00-01', '00 01', '1'.repeat(21)])('rejects %s', (c) => expect(employeeCodeError(c)).toMatch(/digits only/));
  it('accepts the current code unchanged, rejects a different non-digit one', () => {
    expect(employeeCodeError('EMP001', 'EMP001')).toBeNull();
    expect(employeeCodeError('EMP002', 'EMP001')).toMatch(/digits only/);
  });
});
