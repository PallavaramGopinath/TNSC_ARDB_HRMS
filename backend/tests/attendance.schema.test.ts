/** Attendance request schemas — status aliases, dates, limits. */
import { describe, expect, it } from 'vitest';
import {
  AttendanceImportSchema,
  AttendanceMonthQuerySchema,
  AttendanceSaveSchema,
  normaliseStatus,
  parseImportStatus,
} from '../src/models/hr/attendance.schema';

describe('status aliases', () => {
  it.each([
    ['P', 'PRESENT'],
    ['present', 'PRESENT'],
    ['a', 'ABSENT'],
    ['L', 'LEAVE'],
    ['H', 'HOLIDAY'],
    ['HD', 'HALF_DAY'],
    ['half day', 'HALF_DAY'],
    ['Half-Day', 'HALF_DAY'],
  ])('%s → %s', (raw, s) => expect(parseImportStatus(raw)).toBe(s));

  it('rejects unknown codes', () => {
    expect(parseImportStatus('X')).toBeNull();
    expect(parseImportStatus('')).toBeNull();
  });

  it('leaves non-strings alone', () => expect(normaliseStatus(null)).toBeNull());
});

describe('AttendanceMonthQuerySchema', () => {
  it('coerces query strings', () =>
    expect(AttendanceMonthQuerySchema.parse({ branchId: '1', year: '2026', month: '11' })).toEqual({ branchId: 1, year: 2026, month: 11 }));
  it('rejects month 13', () => expect(AttendanceMonthQuerySchema.safeParse({ branchId: 1, year: 2026, month: 13 }).success).toBe(false));
});

describe('AttendanceSaveSchema', () => {
  const entry = { employeeId: 1, date: '2026-11-02', status: 'P' };

  it('normalises status and allows null to clear', () => {
    const r = AttendanceSaveSchema.parse({ branchId: 1, entries: [entry, { ...entry, date: '2026-11-03', status: null }] });
    expect(r.entries[0]!.status).toBe('PRESENT');
    expect(r.entries[1]!.status).toBeNull();
  });

  it('rejects impossible dates and empty saves', () => {
    expect(AttendanceSaveSchema.safeParse({ branchId: 1, entries: [{ ...entry, date: '2026-02-30' }] }).success).toBe(false);
    expect(AttendanceSaveSchema.safeParse({ branchId: 1, entries: [] }).success).toBe(false);
  });

  it('caps a save at 3,000 entries', () => {
    const many = Array.from({ length: 3001 }, () => entry);
    expect(AttendanceSaveSchema.safeParse({ branchId: 1, entries: many }).success).toBe(false);
  });
});

describe('AttendanceImportSchema', () => {
  it('defaults to a dry run', () =>
    expect(AttendanceImportSchema.parse({ rows: [{ line: 2, code: 'E1', date: '2026-11-02', status: 'P' }] }).dryRun).toBe(true));
  it('requires rows', () => expect(AttendanceImportSchema.safeParse({ rows: [] }).success).toBe(false));
});
