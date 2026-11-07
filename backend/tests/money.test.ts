/**
 * Parity tests — expected values come from TNCU.Business.Tests
 * (BranchDaySegmentsTests, GratuityCalculatorTests, RetirementLeaveEncashmentServiceTests, IncrementCycleRules).
 */
import { describe, expect, it } from 'vitest';
import {
  blendByEffectiveDate,
  branchDaySegments,
  ceilToStep,
  clamp,
  gratuityActualYears,
  gratuityAmount,
  gratuityPayableYears,
  incrementAmount,
  leaveSalary,
  prorate,
  roundPaiseEven,
  roundRupee,
} from '../src/lib/money';

const HO = 1, TRICHY = 2, DINDIGUL = 3, MADURAI = 4;

describe('roundRupee (half-up to whole rupee)', () => {
  it.each([
    ['10.49', '10'], ['10.50', '11'], ['10.99', '11'], ['0.5', '1'], ['100', '100'], ['749.999', '750'],
  ])('%s → %s', (v, exp) => expect(roundRupee(v).toString()).toBe(exp));
});

describe('roundPaiseEven (loan interest, banker’s rounding)', () => {
  it('rounds midpoint to even', () => {
    expect(roundPaiseEven('2.345').toFixed(2)).toBe('2.34');
    expect(roundPaiseEven('2.355').toFixed(2)).toBe('2.36');
  });
});

describe('clamp', () => {
  it('max 0 means no cap', () => expect(clamp(5000, 0, 0).toString()).toBe('5000'));
  it('applies max and min', () => {
    expect(clamp(5000, 0, 3000).toString()).toBe('3000');
    expect(clamp(100, 500, 3000).toString()).toBe('500');
  });
});

describe('prorate (LOP)', () => {
  it('no unpaid days returns full', () => expect(prorate(30000, 0, 30).toString()).toBe('30000'));
  it('full*(D-u)/D rounded', () => expect(prorate(31000, 3, 31).toString()).toBe('28000'));
  it('half-day pay cut (ML factor 0.5)', () => expect(prorate(30000, 1.5, 30).toString()).toBe('28500'));
});

describe('blendByEffectiveDate', () => {
  it('effective on/before month start → new', () => expect(blendByEffectiveDate(100, 200, '2026-07-01', '2026-07-01', '2026-07-31').toString()).toBe('200'));
  it('effective after month end → old', () => expect(blendByEffectiveDate(100, 200, '2026-08-01', '2026-07-01', '2026-07-31').toString()).toBe('100'));
  it('mid-month day weighting', () =>
    // 30-day June, effective 16th: 15 days old + 15 days new
    expect(blendByEffectiveDate(30000, 30900, '2026-06-16', '2026-06-01', '2026-06-30').toString()).toBe('30450'));
});

describe('branchDaySegments (BranchDaySegmentsTests)', () => {
  it('no transfers → full month at fallback', () =>
    expect(branchDaySegments([], DINDIGUL, '2026-07-01', '2026-07-31')).toEqual([{ branchId: DINDIGUL, days: 31 }]));
  it('transfer joining after month end → opening is FROM branch', () =>
    expect(branchDaySegments([{ fromBranchId: HO, toBranchId: TRICHY, joining: '2026-06-19' }], TRICHY, '2026-05-01', '2026-05-31'))
      .toEqual([{ branchId: HO, days: 31 }]));
  it('June: HO 18 / Trichy 12', () =>
    expect(branchDaySegments([{ fromBranchId: HO, toBranchId: TRICHY, joining: '2026-06-19' }], TRICHY, '2026-06-01', '2026-06-30'))
      .toEqual([{ branchId: HO, days: 18 }, { branchId: TRICHY, days: 12 }]));
  it('joined before month → whole month at destination', () =>
    expect(branchDaySegments([{ fromBranchId: DINDIGUL, toBranchId: MADURAI, joining: '2026-07-03' }], MADURAI, '2026-08-01', '2026-08-31'))
      .toEqual([{ branchId: MADURAI, days: 31 }]));
  it('there-and-back in one month: Dindigul 2 / Madurai 5 / Dindigul 24', () => {
    const segs = branchDaySegments(
      [
        { fromBranchId: DINDIGUL, toBranchId: MADURAI, joining: '2026-07-03' },
        { fromBranchId: MADURAI, toBranchId: DINDIGUL, joining: '2026-07-08' },
      ],
      DINDIGUL, '2026-07-01', '2026-07-31');
    expect(segs).toEqual([{ branchId: DINDIGUL, days: 2 }, { branchId: MADURAI, days: 5 }, { branchId: DINDIGUL, days: 24 }]);
    expect(segs.reduce((a, s) => a + s.days, 0)).toBe(31);
  });
});

describe('increment (CeilTo10, paise dropped first)', () => {
  it.each([
    ['25000', '750'], ['25350', '760'], ['25400', '770'], ['20033', '600'], ['20034', '610'],
  ])('3%% of %s → %s', (basic, exp) => expect(incrementAmount(basic).toString()).toBe(exp));
  it('600.99 settles at 600', () => expect(ceilToStep('600.99').toString()).toBe('600'));
});

describe('gratuity (GratuityCalculatorTests)', () => {
  it.each([
    ['2020-01-01', '2030-06-01', 10], ['2020-01-01', '2030-07-01', 11], ['2020-01-01', '2030-06-30', 10],
    ['2020-01-01', '2030-12-31', 11], ['2020-01-01', '2031-01-01', 11], ['2020-01-01', '2020-06-30', 0],
    ['2020-01-01', '2020-07-01', 1], ['2020-01-15', '2025-07-14', 5], ['2020-01-15', '2025-07-15', 6],
  ])('payable years %s → %s = %i', (f, t, exp) => expect(gratuityPayableYears(f, t)).toBe(exp));
  it.each([
    ['2020-01-01', '2030-06-01', 10], ['2020-01-01', '2030-07-01', 10], ['2021-07-01', '2026-05-31', 4], ['2020-01-01', '2020-07-01', 0],
  ])('actual years %s → %s = %i', (f, t, exp) => expect(gratuityActualYears(f, t)).toBe(exp));
  it('82,560 × 15/26 × 31 = 1,476,554', () => expect(gratuityAmount(82560, 31).raw.toString()).toBe('1476554'));
  it('ceiling caps payable', () => expect(gratuityAmount(82560, 31, 1000000).payable.toString()).toBe('1000000'));
});

describe('leave salary (SLS / encashment)', () => {
  it('1,48,360 × 187.5 / 30 = 927,250', () => expect(leaveSalary(148360, 187.5).toString()).toBe('927250'));
});
