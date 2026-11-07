import { describe, expect, it } from 'vitest';
import { LeaveTypeInputSchema } from '../src/models/hr/leaveType.schema';
import { isSystemCode } from '../src/services/hr/leaveTypeService';

const ok = { leaveName: 'Special Casual Leave', leaveCode: ' scl ', annualQuota: '7', payCutFactor: '0' };

describe('LeaveTypeInputSchema (TNCU EmployeeLeaveTypeSaveRequest)', () => {
  it('uppercases the code, coerces numbers, defaults flags to false', () => {
    expect(LeaveTypeInputSchema.parse(ok)).toEqual({
      leaveName: 'Special Casual Leave', leaveCode: 'SCL', annualQuota: 7, payCutFactor: 0,
      carryForward: false, encashmentAllowed: false, cutsSpecialPayAndDa: false, affectsLeaveBalance: false,
    });
  });
  it.each([
    [{ annualQuota: 366 }, 'annualQuota'], [{ annualQuota: -1 }, 'annualQuota'], [{ payCutFactor: 1.5 }, 'payCutFactor'],
    [{ payCutFactor: 0.333 }, 'payCutFactor'], [{ leaveCode: 'BAD CODE' }, 'leaveCode'], [{ leaveCode: '' }, 'leaveCode'], [{ leaveName: ' ' }, 'leaveName'],
  ])('rejects %j', (patch, field) => {
    const r = LeaveTypeInputSchema.safeParse({ ...ok, ...patch });
    expect(r.success).toBe(false);
    expect(Object.keys(r.success ? {} : r.error.flatten().fieldErrors)).toContain(field);
  });
  it('accepts half pay', () => expect(LeaveTypeInputSchema.parse({ ...ok, payCutFactor: '0.5' }).payCutFactor).toBe(0.5));
});

describe('isSystemCode', () => {
  it('flags CL/EL/ML/LOP only', () => {
    expect(['CL', 'el', 'ML', 'LOP'].every(isSystemCode)).toBe(true);
    expect(isSystemCode('SCL')).toBe(false);
    expect(isSystemCode(null)).toBe(false);
  });
});
