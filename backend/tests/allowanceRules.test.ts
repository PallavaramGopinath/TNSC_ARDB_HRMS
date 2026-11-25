import { describe, expect, it } from 'vitest';
import {
  basicPay,
  computeAllowances,
  dearnessAllowance,
  fixedAllowance,
  hraAmountFor,
  intersectSegments,
  mergeSegments,
  percentAllowance,
  segmentsFor,
  type AllowanceInput,
  type AllowanceRule,
} from '../src/services/payroll/allowanceRules';

const GCC_CCA = { percent: '5.00', minAmount: '1000.00', maxAmount: '1500.00' };
const OTHER_CCA = { percent: '3.00', minAmount: '800.00', maxAmount: '1000.00' };
const ccaParts = (place: string) => (place === 'GCC' ? GCC_CCA : OTHER_CCA);
const fixed = (amount: number | string, rowId = 1): AllowanceRule => ({ kind: 'FIXED', rowId, label: 'Assistant', amount: String(amount) });
const percent = (p: typeof GCC_CCA, rowId = 1): AllowanceRule => ({ kind: 'PERCENT', rowId, label: 'Place', ...p });

const input = (o: Partial<AllowanceInput> = {}): AllowanceInput => ({
  pay: { basic: '22500.00', pp: 0, gp: 0 },
  daRate: { id: 9, percentage: '30.38' },
  medicalAmount: 1000,
  hra: [{ key: fixed(3000, 11), days: 30 }],
  cca: [{ key: percent(GCC_CCA, 21), days: 30 }],
  totalDays: 30,
  asOn: '2026-11-30',
  ...o,
});

/** Spec §5. */
const HRA: Array<[string, number, number]> = [
  ['Deputy General Manager', 5000, 5000],
  ['Manager', 4000, 3500],
  ['Assistant Manager', 4000, 3500],
  ['Superintendent', 4000, 3500],
  ['DO', 4000, 3500],
  ['AO', 4000, 3500],
  ['ADO', 4000, 3500],
  ['Assistant', 3000, 2500],
  ['Driver', 3000, 2500],
  ['Office Assistant', 3000, 2500],
  ['Selection Grade Office Assistant', 3000, 2500],
  ['Special Grade Office Assistant', 3000, 2500],
];
const hraRow = (name: string) => {
  const [, gcc, other] = HRA.find(([n]) => n === name)!;
  return { gcc_amount: gcc.toFixed(2), other_amount: other.toFixed(2) };
};

describe('Basic Pay (spec §3)', () => {
  it('is BASIC + PP + GP', () => expect(basicPay({ basic: '20000.00', pp: '500.00', gp: '2000.00' }).toNumber()).toBe(22500));
});

describe('DA (spec §4.2, §13)', () => {
  it.each([[6835.49, 6835], [6835.5, 6836], [6835.51, 6836]])('rounds %d to %d', (before, after) =>
    // rate 100% leaves only the rounding
    expect(dearnessAllowance(before, 100).toNumber()).toBe(after));
});

describe('HRA amount (spec §5)', () => {
  it.each(HRA)('%s: %d in GCC, %d elsewhere', (name, gcc, other) => {
    expect(hraAmountFor(hraRow(name), 'GCC')!.toNumber()).toBe(gcc);
    for (const p of ['OC', 'ODHQ', 'OP', 'NEW']) expect(hraAmountFor(hraRow(name), p)!.toNumber()).toBe(other);
  });
  it('needs a place when the amounts differ', () => expect(hraAmountFor(hraRow('Assistant'), null)).toBeNull());
  it('needs no place when they are equal (Deputy General Manager)', () =>
    expect(hraAmountFor(hraRow('Deputy General Manager'), null)!.toNumber()).toBe(5000));
});

describe('CCA boundaries (spec §13)', () => {
  it.each([
    ['GCC', 20000, 1000], ['GCC', 30000, 1500], ['GCC', 30010, 1500],
    ['OC', 26660, 800], ['ODHQ', 26700, 801], ['OP', 33330, 1000], ['OP', 33400, 1000],
  ])('%s, Basic Pay %d → %d', (place, pay, cca) => expect(percentAllowance(pay, ccaParts(place), 30, 30).toNumber()).toBe(cca));
});

describe('worked examples (spec §8)', () => {
  it.each([
    ['Deputy General Manager', 'GCC', 51160, 15542, 5000, 1500, 23042],
    ['Deputy General Manager', 'ODHQ', 51160, 15542, 5000, 1000, 22542],
    ['Superintendent', 'OC', 29230, 8880, 3500, 877, 14257],
    ['Assistant', 'GCC', 22500, 6836, 3000, 1125, 11961],
    ['Office Assistant', 'GCC', 14630, 4445, 3000, 1000, 9445],
    ['Office Assistant', 'OP', 14630, 4445, 2500, 800, 8745],
  ])('%s, %s, Basic Pay %d', (name, place, pay, da, hra, cca, total) => {
    const r = computeAllowances(input({
      pay: { basic: pay, pp: 0, gp: 0 },
      hra: [{ key: fixed(hraAmountFor(hraRow(name), place)!.toString()), days: 30 }],
      cca: [{ key: percent(ccaParts(place)), days: 30 }],
    }));
    expect(r.issues).toEqual([]);
    expect([r.da, r.hra, r.cca, r.ma, r.total].map((v) => v!.toNumber())).toEqual([da, hra, cca, 1000, total]);
  });
});

describe('segments', () => {
  const moves = [{ from: 1, to: 2, on: '2026-06-19' }];
  it('splits on a change inside the period', () =>
    expect(segmentsFor(2, moves, '2026-06-01', '2026-06-30')).toEqual([{ key: 1, days: 18 }, { key: 2, days: 12 }]));
  it('matches the TNCU July 2026 case', () =>
    expect(segmentsFor(1, [{ from: 1, to: 2, on: '2026-07-03' }, { from: 2, to: 1, on: '2026-07-08' }], '2026-07-01', '2026-07-31')).toEqual([
      { key: 1, days: 2 }, { key: 2, days: 5 }, { key: 1, days: 24 },
    ]));
  it('uses the old key before a later change', () => expect(segmentsFor(2, moves, '2026-05-01', '2026-05-31')).toEqual([{ key: 1, days: 31 }]));
  it('gives the whole month to the new key on day 1', () =>
    expect(segmentsFor(2, [{ from: 1, to: 2, on: '2026-06-01' }], '2026-06-01', '2026-06-30')).toEqual([{ key: 2, days: 30 }]));
  it('trusts the employee record after the last change', () => expect(segmentsFor(5, moves, '2026-08-01', '2026-08-31')).toEqual([{ key: 5, days: 31 }]));
  it('overlays a promotion and a transfer', () =>
    expect(intersectSegments([{ key: 'A', days: 10 }, { key: 'B', days: 20 }], [{ key: 'x', days: 18 }, { key: 'y', days: 12 }])).toEqual([
      { key: { a: 'A', b: 'x' }, days: 10 }, { key: { a: 'B', b: 'x' }, days: 8 }, { key: { a: 'B', b: 'y' }, days: 12 },
    ]));
  it('prorates each part of a split month', () => {
    const r = computeAllowances(input({
      hra: [{ key: fixed(3000, 11), days: 18 }, { key: fixed(2500, 11), days: 12 }],
      cca: [{ key: percent(GCC_CCA, 21), days: 18 }, { key: percent(OTHER_CCA, 22), days: 12 }],
    }));
    expect(r.hra!.toNumber()).toBe(1800 + 1000);
    // GCC 675 within 600–900; other 270 raised to 800 × 12/30 = 320
    expect(r.cca!.toNumber()).toBe(675 + 320);
    expect(r.applied).toEqual({ daRateId: 9, hraRowIds: [11], ccaRowIds: [21, 22] });
  });
  it('merges equal terms before rounding', () => {
    const parts = [10, 10, 11].map((days) => ({ key: fixed(5000), days }));
    // 1612.90 + 1612.90 + 1774.19 would round to 1613 + 1613 + 1774 = 5000; 2500 gives 807 + 807 + 887 = 2501
    const uneven = [10, 10, 11].map((days) => ({ key: fixed('2500'), days }));
    const naive = uneven.reduce((t, s) => t + fixedAllowance(2500, s.days, 31).toNumber(), 0);
    expect(naive).not.toBe(2500);
    expect(mergeSegments(parts)).toHaveLength(1);
    expect(computeAllowances(input({ totalDays: 31, hra: uneven })).hra!.toNumber()).toBe(2500);
    const cca = [{ key: percent(OTHER_CCA, 21), days: 10 }, { key: percent({ percent: '3', minAmount: '800', maxAmount: '1000' }, 22), days: 21 }];
    expect(computeAllowances(input({ totalDays: 31, cca })).cca!.toNumber()).toBe(800);
  });
});

describe('missing data never becomes 0 (spec §13)', () => {
  const codes = (o: Partial<AllowanceInput>) => {
    const r = computeAllowances(input(o));
    return { r, errors: r.issues.filter((x) => x.severity === 'ERROR').map((x) => x.code) };
  };
  it('DA rate', () => {
    const { r, errors } = codes({ daRate: null });
    expect([r.da, r.total, errors]).toEqual([null, null, ['DA_RATE']]);
  });
  it.each(['hra', 'cca'] as const)('%s for part of the month', (which) => {
    const { r, errors } = codes({ [which]: [{ key: fixed(3000), days: 10 }, { key: { kind: 'MISSING', message: 'none' }, days: 20 }] });
    expect([r[which], r.total, errors]).toEqual([null, null, [which.toUpperCase()]]);
  });
  it('Medical Allowance', () => {
    const { r, errors } = codes({ medicalAmount: null });
    expect([r.ma, r.total, errors]).toEqual([null, null, ['MA']]);
  });
  it('Basic Pay: no DA, and CCA does not fall to its minimum', () => {
    const { r, errors } = codes({ pay: { basic: 0, pp: 0, gp: 0 } });
    expect([r.da, r.cca, r.total, errors]).toEqual([null, null, null, ['BASIC_PAY']]);
    expect(r.hra!.toNumber()).toBe(3000);
  });
  it('a rate of 0 is paid as 0 but warned about', () => {
    const r = computeAllowances(input({
      daRate: { id: 1, percentage: '0.00' },
      hra: [{ key: fixed(0), days: 30 }],
      cca: [{ key: percent({ percent: '0', minAmount: '800', maxAmount: '0' }), days: 30 }],
    }));
    expect(r.issues.map((x) => [x.code, x.severity])).toEqual([['DA_RATE', 'WARNING'], ['HRA', 'WARNING'], ['CCA', 'WARNING']]);
    expect(r.total!.toNumber()).toBe(1000);
  });
});
