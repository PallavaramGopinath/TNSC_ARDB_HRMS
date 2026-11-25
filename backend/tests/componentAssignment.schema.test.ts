import { describe, expect, it } from 'vitest';
import { AssignmentCreateSchema, AssignmentQuerySchema, AssignmentReviseSchema, AssignmentUpdateSchema } from '../src/models/payroll/componentAssignment.schema';

const fixed = { employeeId: '7', componentId: '2', assignedType: 'FIXED', assignedAmount: '500.50', effectiveFrom: '2026-04-01' };
const pct = { ...fixed, assignedType: 'PERCENTAGE', assignedAmount: '', percentage: '7.5', minimumAmount: '100', maximumAmount: '900' };
const issues = (r: { success: boolean; error?: { issues: Array<{ path: Array<string | number> }> } }) => r.error?.issues.map((i) => i.path.join('.'));

describe('component assignment schemas (docs §3.1)', () => {
  it('accepts a fixed amount and clears the percentage figures', () =>
    expect(AssignmentCreateSchema.parse({ ...fixed, percentage: '5', minimumAmount: '1', maximumAmount: '2', effectiveTo: '' })).toEqual({
      employeeId: 7, componentId: 2, assignedType: 'FIXED', assignedAmount: 500.5, percentage: 0, minimumAmount: 0, maximumAmount: 0, effectiveFrom: '2026-04-01', effectiveTo: null,
    }));
  it('accepts a percentage with limits and clears the amount', () =>
    expect(AssignmentCreateSchema.parse({ ...pct, assignedAmount: '55' })).toMatchObject({ assignedType: 'PERCENTAGE', assignedAmount: 0, percentage: 7.5, minimumAmount: 100, maximumAmount: 900 }));

  it.each(['', null, undefined, 'abc', '-1', '1.234', '999999999'])('rejects fixed amount %s (a blank is never 0)', (v) =>
    expect(issues(AssignmentCreateSchema.safeParse({ ...fixed, assignedAmount: v }))).toEqual(['assignedAmount']));
  it('accepts an explicit 0 amount', () => expect(AssignmentCreateSchema.safeParse({ ...fixed, assignedAmount: 0 }).success).toBe(true));
  it.each(['', null, '0', '-5', '100.01', '7.555'])('rejects percentage %s', (v) =>
    expect(issues(AssignmentCreateSchema.safeParse({ ...pct, percentage: v }))).toEqual(['percentage']));
  it('needs the maximum to be 0 or at least the minimum', () => {
    expect(issues(AssignmentCreateSchema.safeParse({ ...pct, maximumAmount: '99' }))).toEqual(['maximumAmount']);
    expect(AssignmentCreateSchema.safeParse({ ...pct, maximumAmount: '0' }).success).toBe(true);
  });

  it('needs a known type, an employee, a component and a start date', () => {
    expect(issues(AssignmentCreateSchema.safeParse({ ...fixed, assignedType: 'FORMULA' }))).toEqual(['assignedType']);
    expect(issues(AssignmentCreateSchema.safeParse({ ...fixed, employeeId: '', componentId: 'x' }))).toEqual(['employeeId', 'componentId']);
    expect(issues(AssignmentCreateSchema.safeParse({ ...fixed, effectiveFrom: '' }))).toEqual(['effectiveFrom']);
  });
  it('rejects an end before the start', () => {
    expect(issues(AssignmentCreateSchema.safeParse({ ...fixed, effectiveTo: '2026-03-31' }))).toEqual(['effectiveTo']);
    expect(issues(AssignmentUpdateSchema.safeParse({ ...fixed, effectiveTo: '2026-03-31' }))).toEqual(['effectiveTo']);
  });
  it('allows a blank start on edit only, and drops the keys that cannot change', () => {
    const r = AssignmentUpdateSchema.parse({ ...fixed, effectiveFrom: '' });
    expect(r.effectiveFrom).toBeNull();
    expect(r).not.toHaveProperty('employeeId');
    expect(AssignmentReviseSchema.safeParse({ ...fixed, effectiveFrom: '' }).success).toBe(false);
  });

  it('query: blank ids are ignored, paging has defaults, unknown status is refused', () => {
    expect(AssignmentQuerySchema.parse({ employeeId: '', componentId: '3' })).toEqual({ componentId: 3, page: 1, size: 50 });
    expect(AssignmentQuerySchema.safeParse({ status: 'OLD' }).success).toBe(false);
  });
});
