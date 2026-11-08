import { describe, expect, it } from 'vitest';
import { keyDaySegments } from '../src/lib/money';
import { basisChangeWindow, findOverlap, keyAsOn, parseBasis, rateStatus, type PeriodState } from '../src/services/payroll/hraCcaRules';

describe('rateStatus (spec §5.2)', () => {
  const r = (from: string, to: string | null, active = true) => ({ is_active: active, effective_from: from, effective_to: to });
  it('is CURRENT inside the range, open-ended or bounded', () => {
    expect(rateStatus(r('2026-04-01', null), '2026-11-30')).toBe('CURRENT');
    expect(rateStatus(r('2026-04-01', '2026-11-30'), '2026-11-30')).toBe('CURRENT');
    expect(rateStatus(r('2026-11-30', null), '2026-11-30')).toBe('CURRENT');
  });
  it('is FUTURE before start and EXPIRED after end', () => {
    expect(rateStatus(r('2026-12-01', null), '2026-11-30')).toBe('FUTURE');
    expect(rateStatus(r('2024-04-01', '2026-03-31'), '2026-11-30')).toBe('EXPIRED');
  });
  it('is INACTIVE when deactivated, whatever the dates', () => expect(rateStatus(r('2026-04-01', null, false), '2026-11-30')).toBe('INACTIVE'));
});

describe('findOverlap (spec test 8)', () => {
  const rows = [
    { id: 1, effective_from: '2024-04-01', effective_to: '2026-03-31' },
    { id: 2, effective_from: '2026-04-01', effective_to: null },
  ];
  it('rejects a range touching an existing one', () => {
    expect(findOverlap('2026-03-31', '2026-03-31', rows)?.id).toBe(1);
    expect(findOverlap('2027-01-01', null, rows)?.id).toBe(2);
    expect(findOverlap('2020-01-01', null, rows)?.id).toBe(1);
  });
  it('accepts a range in a gap and ignores the row being edited', () => {
    expect(findOverlap('2020-01-01', '2024-03-31', rows)).toBeUndefined();
    expect(findOverlap('2026-05-01', null, rows, 2)).toBeUndefined();
  });
});

describe('keyAsOn (designation / branch held on a date)', () => {
  // Assistant (1) → Asst. Manager (2) on 2026-06-15 → Manager (3) on 2026-12-01; employee record now says 3.
  const promos = [
    { from: 2, to: 3, on: '2026-12-01' },
    { from: 1, to: 2, on: '2026-06-15' },
  ];
  it('returns the current key when no change is later than the date', () => expect(keyAsOn(3, promos, '2026-12-01')).toBe(3));
  it('walks back to the key before the earliest later change', () => {
    expect(keyAsOn(3, promos, '2026-11-30')).toBe(2);
    expect(keyAsOn(3, promos, '2026-06-14')).toBe(1);
  });
  it('returns the current key with no history', () => expect(keyAsOn(7, [], '2026-01-01')).toBe(7));
});

describe('keyDaySegments with promotions (spec §4.2, test 12)', () => {
  it('splits HRA days by designation on a mid-month promotion', () =>
    expect(keyDaySegments([{ from: 1, to: 2, on: '2026-11-16' }], 2, '2026-11-01', '2026-11-30')).toEqual([
      { key: 1, days: 15 },
      { key: 2, days: 15 },
    ]));
  it('gives the whole month to the new designation when effective on day 1', () =>
    expect(keyDaySegments([{ from: 1, to: 2, on: '2026-11-01' }], 2, '2026-11-01', '2026-11-30')).toEqual([{ key: 2, days: 30 }]));
});

describe('basisChangeWindow (spec §4.4, test 6)', () => {
  const p = (month: number, status: string, bills: number, type = 'SALARY'): PeriodState => {
    const mm = String(month).padStart(2, '0');
    const last = new Date(Date.UTC(2026, month, 0)).getUTCDate();
    return { from_date: `2026-${mm}-01`, to_date: `2026-${mm}-${last}`, month, calendar_year: 2026, payroll_type: type, payroll_status: status, bill_count: bills };
  };
  it('applies from the open SALARY month when it has no bills yet', () =>
    expect(basisChangeWindow([p(10, 'LOCKED', 40), p(11, 'OPEN', 0)], '2026-11-07')).toEqual({ canChange: true, blockedReason: null, effectiveFrom: '2026-11-01' }));
  it('is blocked while a period has bills and is not locked', () => {
    const w = basisChangeWindow([p(10, 'LOCKED', 40), p(11, 'PROCESSED', 40)], '2026-11-07');
    expect(w.canChange).toBe(false);
    expect(w.blockedReason).toBe('Finalise or cancel the open payroll for Nov 2026 before changing the basis.');
  });
  it('is blocked by an approved but unlocked arrears run too', () =>
    expect(basisChangeWindow([p(10, 'LOCKED', 40), p(11, 'OPEN', 0), p(9, 'APPROVED', 5, 'DA_ARREARS')], '2026-11-07').canChange).toBe(false));
  it('applies from the day after the last locked month when nothing is open', () =>
    expect(basisChangeWindow([p(9, 'LOCKED', 40), p(10, 'LOCKED', 40)], '2026-11-07').effectiveFrom).toBe('2026-11-01'));
  it('applies from the current month on a fresh install', () =>
    expect(basisChangeWindow([], '2026-11-07').effectiveFrom).toBe('2026-11-01'));
});

describe('parseBasis', () => {
  it('defaults anything unknown to PLACE', () => {
    expect(parseBasis('DESIGNATION')).toBe('DESIGNATION');
    expect(parseBasis(undefined)).toBe('PLACE');
    expect(parseBasis('designation')).toBe('PLACE');
  });
});
