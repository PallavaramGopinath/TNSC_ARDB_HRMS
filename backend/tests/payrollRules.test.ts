import { describe, expect, it } from 'vitest';
import type { AllowanceRule } from '../src/services/payroll/allowanceRules';
import { computeBill, daysHeld, isAgencyDeduction, type BillInput, type PayAssignment, type PayComponent } from '../src/services/payroll/payrollRules';

const CODES: Array<[string, number]> = [
  ['BASIC', 1], ['PP', 1], ['GP', 1], ['SP', 1], ['DA', 1], ['HRA', 1], ['CCA', 1], ['MA', 1], ['EMPLOYER_PF', 1], ['BONUS', 1], ['WASH', 1],
  ['PF', 2], ['ADL PF', 2], ['LIC', 2], ['SOCIETY', 2], ['CARLOAN', 3],
];
const make = () => new Map<string, PayComponent>(CODES.map(([code, type], n) => [code, { id: n + 1, code, name: code, type, isActive: true }]));
const components = make();
const id = (code: string) => components.get(code)!.id;

let next = 1;
const assign = (code: string, amount: number, o: Partial<PayAssignment> = {}): PayAssignment => ({
  id: next++, component: components.get(code)!, assignedType: 'FIXED', amount, percentage: 0, minAmount: 0, maxAmount: 0, from: null, to: null, ...o,
});
const pct = (code: string, percentage: number, o: Partial<PayAssignment> = {}) => assign(code, 0, { assignedType: 'PERCENTAGE', percentage, ...o });
const fixed = (amount: number): AllowanceRule => ({ kind: 'FIXED', rowId: 1, label: 'Assistant', amount: String(amount) });
const rate = (percent: number, min: number, max: number): AllowanceRule => ({ kind: 'PERCENT', rowId: 1, label: 'GCC', percent: String(percent), minAmount: String(min), maxAmount: String(max) });

const JUNE = { from: '2026-06-01', to: '2026-06-30' };
const base = (o: Partial<BillInput> = {}): BillInput => ({
  period: JUNE, service: JUNE, basicFallback: 0,
  assignments: [assign('BASIC', 30000), assign('PP', 300), assign('GP', 2400), assign('SP', 500)],
  leave: [], daRate: { id: 1, percentage: '50' }, pfRate: { id: 2, percentage: '12' }, medicalAmount: 1000,
  hra: [{ key: rate(10, 1000, 5000), days: 30 }], cca: [{ key: rate(5, 1000, 1500), days: 30 }],
  uploaded: new Map(), overrides: new Map(), components, minNetPercent: 25, pfWageCeiling: 0, employerPfEqualsEmployee: true, ...o,
});
const line = (b: ReturnType<typeof computeBill>, code: string) => {
  const l = b.lines.find((x) => x.component.code === code);
  return l ? (l.deduction.isZero() ? l.allowance : l.deduction).toNumber() : null;
};
const codes = (b: ReturnType<typeof computeBill>, severity: 'ERROR' | 'WARNING') => b.issues.filter((i) => i.severity === severity).map((i) => i.code);
const balances = (b: ReturnType<typeof computeBill>) => {
  expect(b.net.eq(b.gross.minus(b.deductions))).toBe(true);
  expect(b.gross.eq(b.lines.reduce((s, l) => s.plus(l.allowance), b.gross.times(0)))).toBe(true);
};

describe('worked example (spec 08 §7.15 under the SLDB rules)', () => {
  const b = computeBill(base({
    assignments: [...base().assignments, assign('ADL PF', 1000), assign('LIC', 1200), assign('SOCIETY', 1000)],
    leave: [{ days: 2, factor: 1, cutsSpDa: true }, { days: 2, factor: 0.5, cutsSpDa: false }],
  }));
  it.each([['BASIC', 27000], ['PP', 270], ['GP', 2160], ['SP', 467], ['DA', 15260], ['HRA', 3270], ['CCA', 1500], ['MA', 1000], ['PF', 5363], ['EMPLOYER_PF', 5363], ['ADL PF', 1000], ['LIC', 1200], ['SOCIETY', 1000]])(
    '%s %d', (code, amount) => expect(line(b, code)).toBe(amount));
  it('totals', () => {
    expect([b.gross, b.deductions, b.net].map(Number)).toEqual([56290, 13926, 42364]);
    expect([b.payableDays.toNumber(), b.serviceDays, b.pfWages.toNumber()]).toEqual([27, 30, 44690]);
    expect(b.minimumNet.toNumber()).toBe(12732); // 25% of 50,927
    expect(b.issues).toEqual([]);
    balances(b);
  });
});

describe('days of service (Q3)', () => {
  it('pays every earning for the days from joining', () => {
    const b = computeBill(base({
      service: { from: '2026-06-16', to: '2026-06-30' },
      assignments: [...base().assignments, assign('WASH', 301)],
      hra: [{ key: fixed(3000), days: 15 }], cca: [{ key: rate(5, 1000, 1500), days: 15 }],
    }));
    expect(['BASIC', 'PP', 'GP', 'SP', 'DA', 'HRA', 'CCA', 'MA', 'WASH'].map((c) => line(b, c))).toEqual([15000, 150, 1200, 250, 8175, 1500, 750, 500, 151]);
    expect(codes(b, 'WARNING')).toEqual(['PART_MONTH']);
    expect(b.issues[0]!.message).toBe('Joined on 2026-06-16; paid for 15 of 30 days');
  });
  it('does not reduce twice when the assignment starts on the joining date', () => {
    const from = '2026-06-16';
    const b = computeBill(base({ service: { from, to: JUNE.to }, assignments: [assign('BASIC', 30000, { from })] }));
    expect(line(b, 'BASIC')).toBe(15000);
    expect(codes(b, 'WARNING')).toEqual(['PART_MONTH']);
  });
  it('pays a leaver to the last day and takes loss of pay from the days served', () => {
    const b = computeBill(base({ service: { from: JUNE.from, to: '2026-06-10' }, leave: [{ days: 1, factor: 1, cutsSpDa: true }] }));
    expect([line(b, 'BASIC'), line(b, 'DA'), b.payableDays.toNumber()]).toEqual([9000, 4905, 9]);
  });
  it('refuses more leave than days in service', () => {
    const b = computeBill(base({ service: { from: '2026-06-29', to: JUNE.to }, leave: [{ days: 3, factor: 1, cutsSpDa: true }] }));
    expect(codes(b, 'ERROR')).toContain('LEAVE');
    expect(b.payableDays.toNumber()).toBe(0);
  });
});

describe('loss of pay (Q2)', () => {
  it('a whole month unpaid leaves HRA, CCA and MA', () => {
    const b = computeBill(base({ leave: [{ days: 30, factor: 1, cutsSpDa: true }] }));
    expect(['BASIC', 'SP', 'DA', 'PF', 'HRA', 'CCA', 'MA'].map((c) => line(b, c))).toEqual([null, null, null, null, 3270, 1500, 1000]);
  });
  it('half pay leave does not cut SP and DA', () => {
    const b = computeBill(base({ leave: [{ days: 10, factor: 0.5, cutsSpDa: false }] }));
    expect([line(b, 'BASIC'), line(b, 'SP'), line(b, 'DA')]).toEqual([25000, 500, 16350]);
  });
});

describe('assignment changed within the month (Q4)', () => {
  it('shares earnings by days: 30,000 → 30,900 from 11 June is 30,600', () => {
    const b = computeBill(base({ assignments: [assign('BASIC', 30000, { to: '2026-06-10' }), assign('BASIC', 30900, { from: '2026-06-11' })] }));
    expect(line(b, 'BASIC')).toBe(30600);
  });
  it('takes a deduction as at the month end, once', () => {
    const b = computeBill(base({ assignments: [...base().assignments, assign('LIC', 500, { to: '2026-06-10' }), assign('LIC', 800, { from: '2026-06-11' }), assign('SOCIETY', 100, { to: '2026-06-20' })] }));
    expect([line(b, 'LIC'), line(b, 'SOCIETY')]).toEqual([800, null]);
    expect(b.lines.filter((l) => l.component.code === 'LIC')).toHaveLength(1);
  });
  it('shares another earning that starts within the month', () =>
    expect(line(computeBill(base({ assignments: [...base().assignments, assign('WASH', 300, { from: '2026-06-21' })] })), 'WASH')).toBe(100));
  it('uses the latest start when rows overlap', () => {
    const list = [assign('BASIC', 1, { from: null }), assign('BASIC', 2, { from: '2026-06-11' })];
    expect(daysHeld(list, JUNE).map((p) => [p.assignment!.amount, p.days])).toEqual([[1, 10], [2, 20]]);
  });
});

describe('Basic Pay', () => {
  it('falls back to the employee record with a warning', () => {
    const b = computeBill(base({ assignments: [], basicFallback: '20000.00' }));
    expect(line(b, 'BASIC')).toBe(20000);
    expect(codes(b, 'WARNING')).toEqual(['BASIC_FALLBACK']);
  });
  it('is an error when missing for the month or part of it', () => {
    expect(codes(computeBill(base({ assignments: [] })), 'ERROR')).toContain('BASIC_PAY');
    expect(codes(computeBill(base({ assignments: [assign('GP', 2400)] })), 'ERROR')).toEqual(['BASIC_PAY']);
    const b = computeBill(base({ assignments: [assign('BASIC', 30000, { from: '2026-06-11' })] }));
    expect(b.issues.find((i) => i.code === 'BASIC_PAY')!.message).toBe('Basic Pay is not set for 10 of 30 days');
  });
  it('leaves SP out of DA and PF wages', () => {
    const a = computeBill(base());
    const b = computeBill(base({ assignments: [assign('BASIC', 30000), assign('PP', 300), assign('GP', 2400), assign('SP', 9000)] }));
    expect([line(a, 'DA'), line(a, 'PF')]).toEqual([line(b, 'DA'), line(b, 'PF')]);
  });
});

describe('other earnings', () => {
  it('applies minimum and maximum to a percentage only (Q7), on the new Basic Pay (Q12)', () => {
    const amount = (a: PayAssignment) => line(computeBill(base({ assignments: [...base().assignments, a] })), 'WASH');
    expect(amount(pct('WASH', 1))).toBe(327);
    expect(amount(pct('WASH', 1, { minAmount: 400 }))).toBe(400);
    expect(amount(pct('WASH', 1, { maxAmount: 300 }))).toBe(300);
    expect(amount(assign('WASH', 250.5, { minAmount: 400 }))).toBe(250.5);
  });
  it('ignores an assignment payroll works out itself, with a warning', () => {
    const b = computeBill(base({ assignments: [...base().assignments, assign('BONUS', 5000), assign('PF', 99), assign('HRA', 99)] }));
    expect([line(b, 'BONUS'), line(b, 'PF'), line(b, 'HRA')]).toEqual([null, 5886, 3270]);
    expect(codes(b, 'WARNING')).toEqual(['IGNORED', 'IGNORED', 'IGNORED']);
  });
});

describe('PF and VPF', () => {
  it('employer PF raises gross and deductions equally', () => {
    const b = computeBill(base());
    const l = b.lines.find((x) => x.component.code === 'EMPLOYER_PF')!;
    expect(l.allowance.eq(l.deduction) && l.allowance.eq(b.employerPf)).toBe(true);
    expect(b.employerPf.toNumber()).toBe(5886); // 12% of 49,050
  });
  it('honours a wage ceiling', () => expect(line(computeBill(base({ pfWageCeiling: 15000 })), 'PF')).toBe(1800));
  it('a missing rate is an error, 0% a warning', () => {
    expect(codes(computeBill(base({ pfRate: null })), 'ERROR')).toEqual(['PF_RATE']);
    expect(codes(computeBill(base({ pfRate: { id: 1, percentage: '0' } })), 'WARNING')).toEqual(['PF_RATE']);
  });
  it('has no rule for a different employer PF', () => expect(codes(computeBill(base({ employerPfEqualsEmployee: false })), 'ERROR')).toEqual(['EMPLOYER_PF']));
  it('VPF is fixed, or a percentage of Basic Pay not cut by loss of pay', () => {
    const vpf = (a: PayAssignment, o: Partial<BillInput> = {}) => line(computeBill(base({ assignments: [...base().assignments, a], ...o })), 'ADL PF');
    expect(vpf(assign('ADL PF', 1234.5))).toBe(1234.5);
    expect(vpf(pct('ADL PF', 10), { leave: [{ days: 5, factor: 1, cutsSpDa: true }] })).toBe(3270);
    expect(vpf(pct('ADL PF', 10, { maxAmount: 2000 }))).toBe(2000);
    expect(vpf(pct('ADL PF', 10), { service: { from: '2026-06-16', to: JUNE.to } })).toBe(1635);
  });
});

describe('agency deductions and edits', () => {
  const lic = assign('LIC', 1200);
  const loan = assign('CARLOAN', 2000);
  const with_ = (o: Partial<BillInput>) => computeBill(base({ assignments: [...base().assignments, lic, loan], ...o }));
  it('uses the uploaded amount, else the assigned one, for types 2 and 3', () => {
    const b = with_({ uploaded: new Map([[id('LIC'), '900']]) });
    expect([line(b, 'LIC'), line(b, 'CARLOAN')]).toEqual([900, 2000]);
  });
  it('0 waives it', () => {
    const b = with_({ uploaded: new Map([[id('LIC'), '0.00']]) });
    expect(line(b, 'LIC')).toBeNull();
    expect(b.editable.find((e) => e.component.code === 'LIC')!.amount.toNumber()).toBe(0);
  });
  it('an edited amount replaces the calculated one; employer PF does not follow an edited PF', () => {
    const b = with_({ overrides: new Map([[id('LIC'), '0'], [id('PF'), '100']]) });
    expect([line(b, 'LIC'), line(b, 'PF'), b.employerPf.toNumber()]).toEqual([null, 100, 5886]);
    balances(b);
  });
  it('an edit or upload of a deduction no longer assigned is reported, not deducted', () => {
    const b = computeBill(base({ overrides: new Map([[id('LIC'), '500']]), uploaded: new Map([[id('SOCIETY'), '700']]) }));
    expect([line(b, 'LIC'), line(b, 'SOCIETY')]).toEqual([null, null]);
    expect(codes(b, 'WARNING').sort()).toEqual(['OVERRIDE', 'UPLOAD']);
  });
  it('knows which deductions are uploaded', () => {
    expect([lic, loan, assign('PF', 1), assign('ADL PF', 1), assign('WASH', 1), pct('LIC', 1)].map(isAgencyDeduction)).toEqual([true, true, false, false, false, false]);
  });
});

describe('errors and warnings', () => {
  it('missing DA, MA, HRA and CCA are errors', () => {
    const missing: AllowanceRule = { kind: 'MISSING', message: 'none' };
    const b = computeBill(base({ daRate: null, medicalAmount: null, hra: [{ key: missing, days: 30 }], cca: [{ key: missing, days: 30 }] }));
    expect(codes(b, 'ERROR').sort()).toEqual(['CCA', 'DA_RATE', 'HRA', 'MA']);
  });
  it('a component not set up is an error', () => {
    const some = make();
    some.delete('EMPLOYER_PF');
    some.get('CCA')!.isActive = false;
    const b = computeBill(base({ components: some }));
    expect(b.issues.map((i) => i.message)).toEqual(['Component CCA is not set up or is inactive', 'Component EMPLOYER_PF is not set up or is inactive']);
    expect(b.employerPf.toNumber()).toBe(0);
  });
  it('net below the minimum warns, negative net is an error', () => {
    const net = (lic: number) => computeBill(base({ assignments: [...base().assignments, assign('LIC', lic)] }));
    expect(codes(net(40000), 'WARNING')).toEqual(['NET_LOW']);
    expect(codes(net(90000), 'ERROR')).toEqual(['NET_NEGATIVE']);
  });
});
