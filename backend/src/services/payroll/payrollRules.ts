/**
 * One employee's SALARY pay bill for a period (specs/08-payroll-preparation.md §7 and §14).
 * Pure: no database access, so every rule is unit-tested in tests/payrollRules.test.ts.
 *
 *   D = calendar days of the period · N = days of it in service
 *   Every earning is paid for days of service (Q3). Loss of pay also reduces Basic, PP, GP, SP and DA (Q2):
 *   SP and DA only for leave types that cut them; DA is worked out on full pay and then reduced.
 *
 * Anything missing gives an ERROR issue, which blocks approval; it is never paid as 0 silently.
 */
import { clamp, D, prorate, roundRupee, ZERO, type Decimal, type MoneyInput } from '../../lib/money';
import { addDays, daysInclusive } from '../../lib/dates';
import { ComponentCode as C, ComponentType } from '../../models/enums';
import {
  computeAllowances,
  mergeSegments,
  percentAllowance,
  type AllowanceIssue,
  type AllowanceResult,
  type AllowanceSegment,
} from './allowanceRules';

export type BillIssueCode =
  | AllowanceIssue['code']
  | 'BASIC_FALLBACK' | 'COMPONENT' | 'IGNORED' | 'LEAVE' | 'PF_RATE' | 'EMPLOYER_PF' | 'OVERRIDE' | 'UPLOAD' | 'NET_LOW' | 'NET_NEGATIVE';
export interface BillIssue {
  code: BillIssueCode;
  severity: 'ERROR' | 'WARNING';
  message: string;
}

export interface PayComponent {
  id: number;
  code: string; // trimmed, upper case
  name: string;
  type: number;
  isActive: boolean;
}

export interface PayAssignment {
  id: number;
  component: PayComponent;
  assignedType: 'FIXED' | 'PERCENTAGE';
  amount: MoneyInput;
  percentage: MoneyInput;
  minAmount: MoneyInput;
  maxAmount: MoneyInput;
  from: string | null;
  to: string | null;
}

export interface Span {
  from: string;
  to: string;
}

export interface BillInput {
  /** Period dates; `service` is the part of it the employee served. */
  period: Span;
  service: Span;
  /** employees.basic_salary, for days without a BASIC assignment. */
  basicFallback: MoneyInput;
  assignments: PayAssignment[];
  leave: Array<{ days: number; factor: MoneyInput; cutsSpDa: boolean }>;
  daRate: { id: number; percentage: string } | null;
  pfRate: { id: number; percentage: string } | null;
  medicalAmount: MoneyInput | null;
  hra: AllowanceSegment[];
  cca: AllowanceSegment[];
  /** Month's agency amounts by component id; 0 is a waiver. */
  uploaded: Map<number, string>;
  /** Deductions edited by management, by component id. */
  overrides: Map<number, string>;
  /** Every component, by code. */
  components: Map<string, PayComponent>;
  minNetPercent: MoneyInput;
  pfWageCeiling: MoneyInput;
  employerPfEqualsEmployee: boolean;
}

export interface BillLine {
  component: PayComponent;
  allowance: Decimal;
  deduction: Decimal;
  applied: unknown;
}

export interface BillDeduction {
  component: PayComponent;
  calculated: Decimal;
  amount: Decimal;
}

export interface Bill {
  calendarDays: number;
  serviceDays: number;
  payableDays: Decimal;
  lines: BillLine[];
  gross: Decimal;
  deductions: Decimal;
  net: Decimal;
  employerPf: Decimal;
  pfWages: Decimal;
  minimumNet: Decimal;
  issues: BillIssue[];
  /** Deductions that can be edited, including those that came to 0. */
  editable: BillDeduction[];
  /** Pay and allowances before loss of pay, for the Allowance Preview. */
  pay: { basic: Decimal; pp: Decimal; gp: Decimal };
  allowances: AllowanceResult;
}

const NAMED_PAY = [C.Basic, C.PersonalPay, C.GradePay, C.SpecialPay] as const;
/** Worked out by payroll, or paid through their own payroll types (spec 07 §4.6): an assignment is not paid here. */
const NOT_PAID_BY_ASSIGNMENT = new Set<string>([
  C.DearnessAllowance, C.HouseRentAllowance, C.CityCompensatoryAllowance, C.MedicalAllowance,
  C.ProvidentFund, C.EmployerProvidentFund, C.Bonus, C.ExGratia, C.SurrenderLeaveSalary, C.Gratuity,
]);

export const normaliseCode = (code: string) => code.trim().toUpperCase();

/** A deduction whose amount can be uploaded every month: fixed, and not a provident fund. Includes type 3 (D10). */
export const isAgencyDeduction = (a: Pick<PayAssignment, 'component' | 'assignedType'>) =>
  a.component.isActive && a.assignedType === 'FIXED' && a.component.type !== ComponentType.Earnings &&
  !NOT_PAID_BY_ASSIGNMENT.has(a.component.code) && a.component.code !== C.VoluntaryProvidentFund;

const inForce = (a: PayAssignment, date: string) => (a.from === null || a.from <= date) && (a.to === null || a.to >= date);

/** The assignment in force on a date; the latest start wins if rows overlap. */
export function assignmentOn(list: PayAssignment[], date: string): PayAssignment | null {
  let hit: PayAssignment | null = null;
  for (const a of list)
    if (inForce(a, date) && (!hit || (a.from ?? '') > (hit.from ?? '') || ((a.from ?? '') === (hit.from ?? '') && a.id > hit.id))) hit = a;
  return hit;
}

/** How many days of the span each assignment is in force; `null` = none. */
export function daysHeld(list: PayAssignment[], span: Span): Array<{ assignment: PayAssignment | null; days: number }> {
  const out: Array<{ assignment: PayAssignment | null; days: number }> = [];
  for (let d = span.from; d <= span.to; d = addDays(d, 1)) {
    const assignment = assignmentOn(list, d);
    const last = out[out.length - 1];
    if (last && last.assignment === assignment) last.days++;
    else out.push({ assignment, days: 1 });
  }
  return out;
}

/** A monthly amount over the span: unchanged if it never varies, otherwise the day-weighted average, to Re. 1. */
function average(parts: Array<{ amount: MoneyInput; days: number }>): Decimal {
  const first = D(parts[0]!.amount);
  if (parts.every((p) => D(p.amount).eq(first))) return first;
  const days = parts.reduce((n, p) => n + p.days, 0);
  return roundRupee(parts.reduce((sum, p) => sum.plus(D(p.amount).times(p.days)), ZERO).div(days));
}

export function computeBill(i: BillInput): Bill {
  const issues: BillIssue[] = [];
  const error = (code: BillIssueCode, message: string) => issues.push({ code, severity: 'ERROR', message });
  const warn = (code: BillIssueCode, message: string) => issues.push({ code, severity: 'WARNING', message });

  const days = daysInclusive(i.period.from, i.period.to);
  const served = daysInclusive(i.service.from, i.service.to);
  const part = [i.service.from > i.period.from && `Joined on ${i.service.from}`, i.service.to < i.period.to && `Left on ${i.service.to}`].filter(Boolean);
  if (part.length) warn('PART_MONTH', `${part.join(', ')}; paid for ${served} of ${days} days`);

  // ---- leave
  const leaveDays = i.leave.reduce((n, l) => n + l.days, 0);
  if (leaveDays > served) error('LEAVE', `${leaveDays} days of leave are entered, but only ${served} days are in service`);
  const unpaidFor = (rows: BillInput['leave']) =>
    clamp(rows.reduce((sum, l) => sum.plus(D(l.factor).times(l.days)), ZERO), 0, served);
  const unpaid = unpaidFor(i.leave);
  const unpaidSpDa = unpaidFor(i.leave.filter((l) => l.cutsSpDa));
  const payableDays = D(served).minus(unpaid);
  /** Reduced for days not in service and for unpaid days, with one rounding. */
  const reduce = (full: Decimal, unpaidDays: Decimal) => prorate(full, unpaidDays.plus(days - served), days);

  // ---- lines
  const lines: BillLine[] = [];
  const component = (code: string): PayComponent | null => {
    const c = i.components.get(code);
    if (c?.isActive) return c;
    error('COMPONENT', `Component ${code} is not set up or is inactive`);
    return null;
  };
  const addNamed = (code: string, allowance: Decimal, deduction: Decimal, applied: unknown = null) => {
    if (allowance.isZero() && deduction.isZero()) return;
    const c = component(code);
    if (c) lines.push({ component: c, allowance, deduction, applied });
  };

  // ---- assignments by component
  const byComponent = new Map<number, PayAssignment[]>();
  for (const a of i.assignments) byComponent.set(a.component.id, [...(byComponent.get(a.component.id) ?? []), a]);
  const of = (code: string) => i.assignments.filter((a) => a.component.code === code);

  // ---- Basic, PP, GP, SP
  const held = (code: string) => daysHeld(of(code).filter((a) => a.assignedType === 'FIXED' && a.component.isActive), i.service);
  const fixedPay = (code: string, fallback: MoneyInput = 0) => average(held(code).map((p) => ({ amount: p.assignment?.amount ?? fallback, days: p.days })));
  const basic = fixedPay(C.Basic, i.basicFallback);
  const pp = fixedPay(C.PersonalPay);
  const gp = fixedPay(C.GradePay);
  const sp = fixedPay(C.SpecialPay);
  const unassigned = held(C.Basic).reduce((n, p) => (p.assignment ? n : n + p.days), 0);
  if (unassigned > 0 && D(i.basicFallback).gt(0))
    warn('BASIC_FALLBACK', `No Basic Pay assignment${unassigned < served ? ` for ${unassigned} days` : ''}; the Basic salary of the employee record is used`);
  else if (unassigned > 0 && unassigned < served) error('BASIC_PAY', `Basic Pay is not set for ${unassigned} of ${served} days`);
  // With no PP or GP either, computeAllowances reports it.
  else if (basic.isZero() && pp.plus(gp).gt(0)) error('BASIC_PAY', 'Basic Pay is not set, but Personal Pay or Grade Pay is');

  const allowances = computeAllowances({
    pay: { basic, pp, gp },
    daRate: i.daRate,
    medicalAmount: i.medicalAmount,
    hra: i.hra,
    cca: i.cca,
    totalDays: days,
    asOn: i.period.to,
  });
  issues.push(...allowances.issues);
  const basicPay = allowances.basicPay;

  const basicPaid = reduce(basic, unpaid);
  const ppPaid = reduce(pp, unpaid);
  const gpPaid = reduce(gp, unpaid);
  const daPaid = allowances.da ? reduce(allowances.da, unpaidSpDa) : ZERO;
  addNamed(C.Basic, basicPaid, ZERO);
  addNamed(C.PersonalPay, ppPaid, ZERO);
  addNamed(C.GradePay, gpPaid, ZERO);
  addNamed(C.SpecialPay, reduce(sp, unpaidSpDa), ZERO);
  addNamed(C.DearnessAllowance, daPaid, ZERO, i.daRate && { rateId: i.daRate.id, percentage: i.daRate.percentage });
  const segments = (list: AllowanceSegment[]) => list.map((s) => (s.key.kind === 'MISSING' ? { days: s.days } : { ...s.key, days: s.days }));
  addNamed(C.HouseRentAllowance, allowances.hra ?? ZERO, ZERO, { segments: segments(i.hra) });
  addNamed(C.CityCompensatoryAllowance, allowances.cca ?? ZERO, ZERO, { segments: segments(i.cca) });
  addNamed(C.MedicalAllowance, allowances.ma ? prorate(allowances.ma, days - served, days) : ZERO, ZERO);

  // ---- other earnings
  const isNamedPay = (code: string) => (NAMED_PAY as readonly string[]).includes(code);
  for (const list of byComponent.values()) {
    const c = list[0]!.component;
    if (!list.some((a) => daysInclusive(a.from && a.from > i.service.from ? a.from : i.service.from, a.to && a.to < i.service.to ? a.to : i.service.to) > 0)) continue;
    if (!c.isActive) {
      warn('IGNORED', `${c.name} is assigned but the component is inactive; it is left out`);
      continue;
    }
    if (NOT_PAID_BY_ASSIGNMENT.has(c.code)) {
      warn('IGNORED', `The assignment of ${c.name} is ignored: it is not paid or deducted by assignment`);
      continue;
    }
    if (c.type !== ComponentType.Earnings) continue;
    if (isNamedPay(c.code)) {
      if (list.some((a) => a.assignedType === 'PERCENTAGE')) warn('IGNORED', `The percentage assignment of ${c.name} is ignored: it must be a fixed amount`);
      continue;
    }
    const rules: AllowanceSegment[] = daysHeld(list, i.service).flatMap(({ assignment: a, days: n }): AllowanceSegment[] =>
      !a ? []
      : a.assignedType === 'FIXED' ? [{ key: { kind: 'FIXED', rowId: a.id, label: c.name, amount: String(a.amount) }, days: n }]
      : [{ key: { kind: 'PERCENT', rowId: a.id, label: c.name, percent: String(a.percentage), minAmount: String(a.minAmount), maxAmount: String(a.maxAmount) }, days: n }]);
    let amount = ZERO;
    for (const s of mergeSegments(rules)) {
      if (s.key.kind === 'FIXED') amount = amount.plus(prorate(s.key.amount, days - s.days, days));
      else if (s.key.kind === 'PERCENT' && basicPay.gt(0)) amount = amount.plus(percentAllowance(basicPay, s.key, s.days, days));
    }
    if (!amount.isZero()) lines.push({ component: c, allowance: amount, deduction: ZERO, applied: null });
  }

  // ---- deductions
  const editable: BillDeduction[] = [];
  const deduct = (c: PayComponent, calculated: Decimal, applied: unknown = null) => {
    const override = i.overrides.get(c.id);
    const amount = override === undefined ? calculated : D(override);
    editable.push({ component: c, calculated, amount });
    if (!amount.isZero()) lines.push({ component: c, allowance: ZERO, deduction: amount, applied: override === undefined ? applied : { calculated: calculated.toFixed(2) } });
  };

  const paidWages = basicPaid.plus(ppPaid).plus(gpPaid).plus(daPaid);
  const ceiling = D(i.pfWageCeiling);
  const pfWages = ceiling.gt(0) && paidWages.gt(ceiling) ? ceiling : paidWages;
  let pf = ZERO;
  let employerPf = ZERO;
  if (!i.pfRate) error('PF_RATE', `No PF rate in force on ${i.period.to}`);
  else if (D(i.pfRate.percentage).isZero()) warn('PF_RATE', 'The PF rate in force is 0%');
  else {
    pf = roundRupee(pfWages.times(i.pfRate.percentage).div(100));
    const applied = { rateId: i.pfRate.id, percentage: i.pfRate.percentage, wages: pfWages.toFixed(2) };
    const c = pf.gt(0) ? component(C.ProvidentFund) : null;
    if (c) deduct(c, pf, applied);
    if (pf.gt(0)) {
      if (!i.employerPfEqualsEmployee) error('EMPLOYER_PF', 'Employer PF is set to differ from employee PF, but no rule for it is defined');
      else {
        employerPf = i.components.get(C.EmployerProvidentFund)?.isActive ? pf : ZERO;
        addNamed(C.EmployerProvidentFund, pf, pf, applied);
      }
    }
  }

  const lastDay = i.service.to;
  const vpf = assignmentOn(of(C.VoluntaryProvidentFund).filter((a) => a.component.isActive), lastDay);
  if (vpf) {
    // A percentage VPF is on Basic + SP + PP as assigned, not cut for unpaid days.
    const vpfBase = basic.plus(sp).plus(pp);
    const amount =
      vpf.assignedType === 'FIXED' ? D(vpf.amount)
      : vpfBase.gt(0) ? clamp(roundRupee(vpfBase.times(served).div(days).times(vpf.percentage).div(100)), vpf.minAmount, vpf.maxAmount)
      : ZERO;
    deduct(vpf.component, amount, vpf.assignedType === 'FIXED' ? { assignmentId: vpf.id } : { assignmentId: vpf.id, base: vpfBase.toFixed(2) });
  }

  const agencyIds = new Set<number>();
  for (const list of byComponent.values()) {
    const c = list[0]!.component;
    if (c.type === ComponentType.Earnings || c.code === C.VoluntaryProvidentFund || NOT_PAID_BY_ASSIGNMENT.has(c.code) || !c.isActive) continue;
    const a = assignmentOn(list, lastDay);
    if (!a) continue;
    if (!isAgencyDeduction(a)) {
      warn('IGNORED', `The percentage assignment of ${c.name} is ignored: a deduction must be a fixed amount`);
      continue;
    }
    agencyIds.add(c.id);
    const uploaded = i.uploaded.get(c.id);
    deduct(c, D(uploaded ?? a.amount), { assignmentId: a.id, uploaded: uploaded !== undefined });
  }

  const nameOf = new Map([...i.components.values()].map((c) => [c.id, c.name]));
  for (const id of i.uploaded.keys())
    if (!agencyIds.has(id)) warn('UPLOAD', `The amount entered for ${nameOf.get(id) ?? 'a deduction'} is not deducted: it is not assigned on ${lastDay}`);
  for (const id of i.overrides.keys())
    if (!editable.some((e) => e.component.id === id))
      warn('OVERRIDE', `The edited amount of ${nameOf.get(id) ?? 'a deduction'} is not applied: the deduction is no longer part of the bill. Remove it in Edit deductions`);

  // ---- totals
  const gross = lines.reduce((sum, l) => sum.plus(l.allowance), ZERO);
  const deductions = lines.reduce((sum, l) => sum.plus(l.deduction), ZERO);
  const net = gross.minus(deductions);
  const minimumNet = roundRupee(gross.minus(employerPf).times(i.minNetPercent).div(100));
  if (net.lt(0)) error('NET_NEGATIVE', `Net pay is negative (${net.toFixed(2)})`);
  else if (net.lt(minimumNet))
    warn('NET_LOW', `Net ${net.toFixed(2)} is below the minimum ${minimumNet.toFixed(2)} (${D(i.minNetPercent)}% of gross excluding employer PF)`);

  return {
    calendarDays: days, serviceDays: served, payableDays, lines, gross, deductions, net, employerPf, pfWages, minimumNet,
    issues: dedupe(issues), editable, pay: { basic, pp, gp }, allowances,
  };
}

/** A missing component is needed by one line only once per message. */
const dedupe = (list: BillIssue[]) => list.filter((x, n) => list.findIndex((y) => y.code === x.code && y.message === x.message) === n);
