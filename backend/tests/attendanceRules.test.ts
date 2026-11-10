/** Daily attendance rules — service span, future dates, payroll locks, CSV date formats. */
import { describe, expect, it } from 'vitest';
import { checkEntry, lockFor, parseFlexibleDate } from '../src/services/hr/attendanceRules';

const emp = { date_of_joining: '2026-03-10', date_of_leaving: null };
const today = '2026-11-10';

describe('checkEntry', () => {
  it('accepts a normal working day', () => expect(checkEntry(emp, '2026-11-02', 'PRESENT', today, [])).toBeNull());

  it('rejects dates before joining, allows the joining day', () => {
    expect(checkEntry(emp, '2026-03-09', 'PRESENT', today, [])).toMatch(/joining/);
    expect(checkEntry(emp, '2026-03-10', 'PRESENT', today, [])).toBeNull();
  });

  it('rejects dates after leaving, allows the leaving day', () => {
    const left = { ...emp, date_of_leaving: '2026-06-30' };
    expect(checkEntry(left, '2026-07-01', 'ABSENT', today, [])).toMatch(/leaving/);
    expect(checkEntry(left, '2026-06-30', 'ABSENT', today, [])).toBeNull();
  });

  it('future dates: only holidays (and clearing)', () => {
    expect(checkEntry(emp, '2026-11-11', 'PRESENT', today, [])).toMatch(/future/);
    expect(checkEntry(emp, '2026-11-11', 'HOLIDAY', today, [])).toBeNull();
    expect(checkEntry(emp, '2026-11-11', null, today, [])).toBeNull();
    expect(checkEntry(emp, today, 'PRESENT', today, [])).toBeNull();
  });

  it('blocks approved or locked salary periods, including clearing', () => {
    const locks = [{ from: '2026-10-01', to: '2026-10-31', status: 'LOCKED' }];
    expect(checkEntry(emp, '2026-10-15', 'PRESENT', today, locks)).toMatch(/locked/);
    expect(checkEntry(emp, '2026-10-31', null, today, locks)).toMatch(/locked/);
    expect(checkEntry(emp, '2026-11-01', 'PRESENT', today, locks)).toBeNull();
  });

  it('no joining date means no lower bound', () =>
    expect(checkEntry({ date_of_joining: null, date_of_leaving: null }, '2001-01-01', 'PRESENT', today, [])).toBeNull());
});

describe('lockFor', () => {
  it('is inclusive at both ends', () => {
    const l = [{ from: '2026-10-01', to: '2026-10-31', status: 'APPROVED' }];
    expect(lockFor('2026-10-01', l)).toBeDefined();
    expect(lockFor('2026-10-31', l)).toBeDefined();
    expect(lockFor('2026-09-30', l)).toBeUndefined();
  });
});

describe('parseFlexibleDate', () => {
  it.each([
    ['2026-11-05', '2026-11-05'],
    ['2026-1-5', '2026-01-05'],
    ['05-11-2026', '2026-11-05'],
    ['5/11/2026', '2026-11-05'],
    ['05.11.2026', '2026-11-05'],
    [' 2026-11-05 ', '2026-11-05'],
  ])('%s → %s', (raw, iso) => expect(parseFlexibleDate(raw)).toBe(iso));

  it.each(['2026-02-30', '31/04/2026', '11/2026', '', 'yesterday'])('rejects %s', (raw) => expect(parseFlexibleDate(raw)).toBeNull());
});
