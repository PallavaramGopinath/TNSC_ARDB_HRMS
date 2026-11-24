/** Employee code input rule (spec 05): blank → generated, otherwise digits only, max 20. */
import { describe, expect, it } from 'vitest';
import { EmployeeInputSchema } from '../src/models/hr/employee.schema';

const parse = (employeeCode: unknown) =>
  EmployeeInputSchema.safeParse({
    employeeName: 'R. Kumar', height: 170, weight: 65, designationId: 1, branchId: 1,
    dateOfJoining: '2020-06-01', dateOfBirth: '1990-01-15', incrementMonth: 7, employeeCode,
  });

describe('EmployeeInputSchema employeeCode', () => {
  it('blank or missing is treated as absent (generated on create)', () => {
    expect(parse(undefined).success).toBe(true);
    expect(parse('').success).toBe(true);
    expect(parse('   ').success).toBe(true);
    expect(parse('').data?.employeeCode).toBeNull();
  });

  it('keeps digits as typed, including leading zeros, after trimming', () => {
    expect(parse(' 0001 ').data?.employeeCode).toBe('0001');
    expect(parse('123').data?.employeeCode).toBe('123');
  });

  it('accepts exactly 20 digits', () => {
    expect(parse('1'.repeat(20)).success).toBe(true);
  });

  it.each([
    ['EMP001', 'letters'],
    ['00-01', 'hyphen'],
    ['00 01', 'inner space'],
    ['1'.repeat(21), 'over 20 characters'],
  ])('rejects %s (%s)', (value) => {
    const r = parse(value);
    expect(r.success).toBe(false);
    expect(r.success ? [] : r.error.issues.map((i) => i.path[0])).toContain('employeeCode');
  });
});
