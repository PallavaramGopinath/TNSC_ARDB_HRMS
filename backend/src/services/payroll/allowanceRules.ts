/**
 * DA, HRA, CCA and MA for a full month (specs/06-allowance-calculation-da-hra-cca-ma.md).
 * Pure: no database access, so every rule is unit-tested in tests/allowanceRules.test.ts.
 *
 * A missing rate, amount or place category gives a null amount and an ERROR issue, never 0.
 * Loss of pay is not applied here (spec §10 Q2, Q3 are open); Payroll Preparation will add it.
 */
import { clamp, D, keyDaySegments, roundRupee, ZERO, type Decimal, type KeyChange, type MoneyInput } from '../../lib/money';
import { keyAsOn } from './hraCcaRules';

/** core.place_categories.code of Greater Chennai Corporation (spec §2). Every other category is "other". */
export const GCC_PLACE_CODE = 'GCC';
export const MEDICAL_ALLOWANCE_KEY = 'payroll.medical_allowance.amount';

export interface DaySegment<K> {
  key: K;
  days: number;
}

/**
 * Day segments of [from, to] for a key held by the employee record (branch, designation). The record is
 * the latest key; dated changes inside the period split it, and changes after it are walked back.
 */
export function segmentsFor<K>(current: K, changes: KeyChange<K>[], from: string, to: string): DaySegment<K>[] {
  const inside = changes.filter((c) => c.on > from && c.on <= to);
  return keyDaySegments(inside, keyAsOn(current, changes, to), from, to);
}

/** Overlay two splits of the same period: each result segment has one key from each. */
export function intersectSegments<A, B>(a: DaySegment<A>[], b: DaySegment<B>[]): DaySegment<{ a: A; b: B }>[] {
  const out: DaySegment<{ a: A; b: B }>[] = [];
  let i = 0;
  let j = 0;
  let leftA = a[0]?.days ?? 0;
  let leftB = b[0]?.days ?? 0;
  while (i < a.length && j < b.length) {
    const days = Math.min(leftA, leftB);
    if (days > 0) out.push({ key: { a: a[i]!.key, b: b[j]!.key }, days });
    leftA -= days;
    leftB -= days;
    if (leftA === 0) leftA = a[++i]?.days ?? 0;
    if (leftB === 0) leftB = b[++j]?.days ?? 0;
  }
  return out;
}

/** Basic Pay = BASIC + PP + GP (spec §3). Special Pay is not part of it. */
export const basicPay = (p: { basic: MoneyInput; pp: MoneyInput; gp: MoneyInput }): Decimal => D(p.basic).plus(p.pp).plus(p.gp);

/** DA (spec §4.2). */
export const dearnessAllowance = (pay: MoneyInput, ratePercent: MoneyInput): Decimal => roundRupee(D(pay).times(ratePercent).div(100));

/**
 * Fixed HRA amount for a place category (spec §5). `null` = it depends on the place and the branch has none.
 * Equal amounts need no place: that is how a Deputy General Manager gets the same HRA everywhere.
 */
export function hraAmountFor(row: { gcc_amount: MoneyInput; other_amount: MoneyInput }, placeCode: string | null): Decimal | null {
  const gcc = D(row.gcc_amount);
  const other = D(row.other_amount);
  if (gcc.eq(other)) return gcc;
  if (placeCode === null) return null;
  return placeCode === GCC_PLACE_CODE ? gcc : other;
}

/** Percentage of Basic Pay with a monthly minimum and maximum (0 = no maximum), for part of a month. */
export interface PercentParts {
  percent: string;
  minAmount: string;
  maxAmount: string;
}
const share = (v: MoneyInput, days: number, totalDays: number) => D(v).times(days).div(totalDays);

export const percentAllowance = (pay: MoneyInput, r: PercentParts, days: number, totalDays: number): Decimal =>
  clamp(
    roundRupee(share(D(pay).times(r.percent).div(100), days, totalDays)),
    roundRupee(share(r.minAmount, days, totalDays)),
    roundRupee(share(r.maxAmount, days, totalDays)),
  );

export const fixedAllowance = (amount: MoneyInput, days: number, totalDays: number): Decimal => roundRupee(share(amount, days, totalDays));

/** What applies to one part of the month, as found by the resolver. `label` names the place or designation. */
export type AllowanceRule =
  | { kind: 'FIXED'; rowId: number; label: string; amount: string }
  | ({ kind: 'PERCENT'; rowId: number; label: string } & PercentParts)
  | { kind: 'MISSING'; message: string };

export type AllowanceSegment = DaySegment<AllowanceRule>;

/** Segments paid on the same terms are added up before rounding, so moving between equal places loses nothing. */
export function mergeSegments(segs: AllowanceSegment[]): AllowanceSegment[] {
  const terms = (r: AllowanceRule) => {
    if (r.kind === 'FIXED') return `F|${D(r.amount)}`;
    if (r.kind === 'PERCENT') return `P|${D(r.percent)}|${D(r.minAmount)}|${D(r.maxAmount)}`;
    return `M|${r.message}`;
  };
  const byTerms = new Map<string, AllowanceSegment>();
  for (const s of segs) {
    const hit = byTerms.get(terms(s.key));
    if (hit) hit.days += s.days;
    else byTerms.set(terms(s.key), { ...s });
  }
  return [...byTerms.values()];
}

export type IssueCode = 'BASIC_PAY' | 'DA_RATE' | 'HRA' | 'CCA' | 'MA' | 'PART_MONTH';
export interface AllowanceIssue {
  code: IssueCode;
  /** ERROR blocks finalisation; WARNING is shown for a check. */
  severity: 'ERROR' | 'WARNING';
  message: string;
}

export interface AllowanceInput {
  pay: { basic: MoneyInput; pp: MoneyInput; gp: MoneyInput };
  /** DA rate in force on the period end date; null = none. */
  daRate: { id: number; percentage: string } | null;
  medicalAmount: MoneyInput | null;
  hra: AllowanceSegment[];
  cca: AllowanceSegment[];
  totalDays: number;
  /** Period end date, for messages. */
  asOn: string;
}

export interface AllowanceResult {
  basicPay: Decimal;
  da: Decimal | null;
  hra: Decimal | null;
  cca: Decimal | null;
  ma: Decimal | null;
  /** DA + HRA + CCA + MA; null while any of them is missing. */
  total: Decimal | null;
  issues: AllowanceIssue[];
  /** Rows used, for the pay line (spec §12.4). */
  applied: { daRateId: number | null; hraRowIds: number[]; ccaRowIds: number[] };
}

const rowIds = (segs: AllowanceSegment[]) => [...new Set(segs.flatMap((s) => (s.key.kind === 'MISSING' ? [] : [s.key.rowId])))];

export function computeAllowances(i: AllowanceInput): AllowanceResult {
  const issues: AllowanceIssue[] = [];
  const error = (code: IssueCode, message: string) => issues.push({ code, severity: 'ERROR', message });
  const warn = (code: IssueCode, message: string) => issues.push({ code, severity: 'WARNING', message });

  const pay = basicPay(i.pay);
  const hasPay = pay.gt(0);
  if (!hasPay) error('BASIC_PAY', 'Basic Pay (BASIC + PP + GP) is not set');

  const segmentTotal = (code: 'HRA' | 'CCA', segs: AllowanceSegment[]): Decimal | null => {
    let sum: Decimal | null = ZERO;
    for (const s of mergeSegments(segs)) {
      const r = s.key;
      if (r.kind === 'MISSING') {
        error(code, r.message);
        sum = null;
        continue;
      }
      if (r.kind === 'PERCENT' && !hasPay) {
        sum = null; // already reported: a percentage of nothing must not become the minimum
        continue;
      }
      const amount =
        r.kind === 'FIXED' ? fixedAllowance(r.amount, s.days, i.totalDays)
        : code === 'CCA' && D(r.percent).isZero() ? ZERO // CCA is paid only when its percentage is non-zero (TNCU)
        : percentAllowance(pay, r, s.days, i.totalDays);
      if (amount.isZero()) warn(code, `${code} for ${r.label} is 0`);
      sum = sum && sum.plus(amount);
    }
    return sum;
  };

  let da: Decimal | null = null;
  if (!i.daRate) error('DA_RATE', `No DA rate in force on ${i.asOn}`);
  else {
    if (D(i.daRate.percentage).isZero()) warn('DA_RATE', 'The DA rate in force is 0%');
    if (hasPay) da = dearnessAllowance(pay, i.daRate.percentage);
  }
  const hra = segmentTotal('HRA', i.hra);
  const cca = segmentTotal('CCA', i.cca);

  let ma: Decimal | null = null;
  if (i.medicalAmount === null) error('MA', `No Medical Allowance amount in force on ${i.asOn}`);
  else ma = D(i.medicalAmount);

  return {
    basicPay: pay,
    da,
    hra,
    cca,
    ma,
    total: da && hra && cca && ma ? da.plus(hra).plus(cca).plus(ma) : null,
    issues,
    applied: { daRateId: i.daRate?.id ?? null, hraRowIds: rowIds(i.hra), ccaRowIds: rowIds(i.cca) },
  };
}
