/** Employee rule tests — TNCU EmployeeDateRules behaviour, plus the zod input schema. */
import { describe, expect, it } from 'vitest';
import { EmployeeInputSchema, type EmployeeInput } from '../src/models/hr/employee.schema';
import { addYears, isCompassionate, validateEmployee } from '../src/services/hr/employeeRules';

const ctx = { businessDate: '2026-11-06', minAgeAtJoining: 18 };
const base = (over: Partial<EmployeeInput> = {}): EmployeeInput =>
  EmployeeInputSchema.parse({
    employeeName: 'R. Kumar', height: 170, weight: 65, designationId: 1, branchId: 1,
    dateOfJoining: '2020-06-01', dateOfBirth: '1990-01-15', incrementMonth: 7, ...over,
  });

describe('addYears', () => {
  it('handles leap day', () => expect(addYears('2008-02-29', 18)).toBe('2026-02-28'));
  it('plain', () => expect(addYears('1990-01-15', 18)).toBe('2008-01-15'));
});

describe('validateEmployee', () => {
  it('valid baseline has no errors', () => expect(validateEmployee(base(), ctx)).toEqual({}));

  it('must be 18 on joining', () => {
    expect(validateEmployee(base({ dateOfBirth: '2003-06-02', dateOfJoining: '2021-06-01' }), ctx).dateOfJoining).toBeDefined();
    expect(validateEmployee(base({ dateOfBirth: '2003-06-01', dateOfJoining: '2021-06-01' }), ctx)).toEqual({});
  });

  it('leaving: not before joining, not after business date', () => {
    expect(validateEmployee(base({ dateOfLeaving: '2019-01-01' }), ctx).dateOfLeaving).toBeDefined();
    expect(validateEmployee(base({ dateOfLeaving: '2026-11-07' }), ctx).dateOfLeaving).toBeDefined();
    expect(validateEmployee(base({ dateOfLeaving: '2026-11-06' }), ctx)).toEqual({});
  });

  it('retirement only checks against joining (future allowed)', () => {
    expect(validateEmployee(base({ dateOfRetirement: '2050-01-31' }), ctx)).toEqual({});
    expect(validateEmployee(base({ dateOfRetirement: '2019-01-31' }), ctx).dateOfRetirement).toBeDefined();
  });

  it('confirmation order details need a confirmation date', () => {
    expect(validateEmployee(base({ confirmationOrderNo: 'C-1' }), ctx).dateOfConfirmation).toBeDefined();
  });

  it('probation extension rules', () => {
    expect(validateEmployee(base({ probationExtensionMonths: 6 }), ctx).probationExtensionMonths).toBeDefined();
    expect(validateEmployee(base({ probationMonths: 48, probationExtensionMonths: 13 }), ctx).probationExtensionMonths).toBeDefined();
    expect(validateEmployee(base({ probationMonths: 24, probationExtensionMonths: 12 }), ctx)).toEqual({});
  });

  it('test date needs test passed', () => {
    expect(validateEmployee(base({ probationTestPassedOn: '2021-01-01' }), ctx).probationTestPassedOn).toBeDefined();
    expect(validateEmployee(base({ probationTestPassed: true, probationTestPassedOn: '2021-01-01' }), ctx)).toEqual({});
  });

  it('deceased details only for compassionate appointments; death on/before joining', () => {
    expect(validateEmployee(base({ deceasedName: 'S. Raman' }), ctx).specialCategory).toBeDefined();
    const ok = base({ modeOfRecruitment: 'COMPASSIONATE_GROUND', deceasedName: 'S. Raman', deceasedDateOfDeath: '2020-01-10' });
    expect(isCompassionate(ok)).toBe(true);
    expect(validateEmployee(ok, ctx)).toEqual({});
    expect(validateEmployee({ ...ok, deceasedDateOfDeath: '2020-07-01' }, ctx).deceasedDateOfDeath).toBeDefined();
  });

  it('IFSC needs a bank', () => expect(validateEmployee(base({ ifscCode: 'SBIN0001234' }), ctx).bankMasterId).toBeDefined());
  it('future order dates rejected', () => expect(validateEmployee(base({ appointmentOrderDate: '2027-01-01' }), ctx).appointmentOrderDate).toBeDefined());
});

describe('EmployeeInputSchema', () => {
  it('blank strings become null and codes are uppercased', () => {
    const v = base({ panNumber: 'abcde1234f' as never, ifscCode: 'sbin0001234' as never, mobile: '' as never });
    expect(v.panNumber).toBe('ABCDE1234F');
    expect(v.ifscCode).toBe('SBIN0001234');
    expect(v.mobile).toBeNull();
  });
  it('rejects bad PAN / Aadhaar / mobile', () => {
    const r = EmployeeInputSchema.safeParse({ ...base(), panNumber: 'X1', aadharNumber: '1234', mobile: '12345' });
    expect(r.success).toBe(false);
    expect(Object.keys(r.success ? {} : r.error.flatten().fieldErrors).sort()).toEqual(['aadharNumber', 'mobile', 'panNumber']);
  });
  it('accepts spaced Aadhaar', () => expect(base({ aadharNumber: '1234 5678 9012' as never }).aadharNumber).toBe('123456789012'));
});
