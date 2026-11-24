import { describe, expect, it } from 'vitest';
import { GradeInputSchema, GradeQuerySchema } from '../src/models/hr/grade.schema';

describe('GradeInputSchema', () => {
  it('trims text and coerces the display order', () => {
    expect(GradeInputSchema.parse({ gradeCode: '  G-1 ', description: ' Officers ', displayOrder: '10', isActive: true })).toEqual({
      gradeCode: 'G-1', description: 'Officers', displayOrder: 10, isActive: true,
    });
  });
  it('needs only a code; blank optional fields are dropped', () => {
    const r = GradeInputSchema.parse({ gradeCode: 'G1', description: ' ', displayOrder: '' });
    expect(r.description).toBeUndefined();
    expect(r.displayOrder).toBeNull();
    expect(GradeInputSchema.parse({ gradeCode: 'G1' }).displayOrder).toBeNull();
  });
  it('accepts the limits', () => {
    expect(GradeInputSchema.safeParse({ gradeCode: 'x'.repeat(50), description: 'x'.repeat(150), displayOrder: 1 }).success).toBe(true);
    expect(GradeInputSchema.safeParse({ gradeCode: 'G1', displayOrder: 999 }).success).toBe(true);
  });
  it.each([
    [{ gradeCode: undefined }, 'gradeCode'],
    [{ gradeCode: '   ' }, 'gradeCode'],
    [{ gradeCode: 'x'.repeat(51) }, 'gradeCode'],
    [{ description: 'x'.repeat(151) }, 'description'],
    [{ displayOrder: 0 }, 'displayOrder'],
    [{ displayOrder: 1000 }, 'displayOrder'],
    [{ displayOrder: 1.5 }, 'displayOrder'],
    [{ displayOrder: 'abc' }, 'displayOrder'],
    [{ isActive: 'yes' }, 'isActive'],
  ])('rejects %j', (patch, field) => {
    const r = GradeInputSchema.safeParse({ gradeCode: 'G1', ...patch });
    expect(r.success).toBe(false);
    expect(Object.keys(r.success ? {} : r.error.flatten().fieldErrors)).toContain(field);
  });
});

describe('GradeQuerySchema', () => {
  it('filters only on active=true', () => {
    expect(GradeQuerySchema.parse({ active: 'true' }).active).toBe(true);
    expect(GradeQuerySchema.parse({ active: 'false' }).active).toBe(false);
    expect(GradeQuerySchema.parse({}).active).toBe(false);
    expect(GradeQuerySchema.safeParse({ active: '1' }).success).toBe(false);
  });
});
