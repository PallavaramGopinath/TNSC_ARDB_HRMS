/**
 * Exact money arithmetic — ports of TNCU_GAMS helpers (C# decimal semantics).
 *   RoundRupee            TNCU.Business/Common/MoneyRounding.cs, PayrollCalculator.cs
 *   Clamp / Pro / Blend   TNCU.Business/Payroll/PayrollCalculator.cs
 *   BranchDaySegments     TNCU.Business/Payroll/PayrollCalculator.cs
 *   CeilTo10              TNCU.Business/HR/IncrementCycleRules.cs
 *   Gratuity years        TNCU.Business/Payroll/GratuityCalculator.cs
 * Never use JS floating point for money: construct Decimal from the DB `numeric` string.
 */
import Decimal from 'decimal.js';
import { dayNumber } from './dates';

// C# decimal carries 28–29 significant digits.
Decimal.set({ precision: 34, rounding: Decimal.ROUND_HALF_UP });

export { Decimal };
export type Money = Decimal;
export type MoneyInput = Decimal.Value;

export const D = (v: MoneyInput | null | undefined): Decimal => new Decimal(v ?? 0);
export const ZERO = new Decimal(0);

/** Round to whole rupee: paise < 50 → floor, paise ≥ 50 → ceil (floor + (frac >= 0.50 ? 1 : 0)). */
export function roundRupee(v: MoneyInput): Decimal {
  const x = D(v);
  const floor = x.floor();
  return floor.plus(x.minus(floor).gte(0.5) ? 1 : 0);
}

/** Banker's rounding to 2 places (TNCU loan interest: Math.Round(x, 2, MidpointRounding.ToEven)). */
export function roundPaiseEven(v: MoneyInput): Decimal {
  return D(v).toDecimalPlaces(2, Decimal.ROUND_HALF_EVEN);
}

/** TNCU Clamp: max ≤ 0 means "no cap". */
export function clamp(v: MoneyInput, min: MoneyInput, max: MoneyInput): Decimal {
  let x = D(v);
  const mx = D(max);
  const mn = D(min);
  if (mx.gt(0) && x.gt(mx)) x = mx;
  if (x.lt(mn)) x = mn;
  return x;
}

/** Leave proration: unpaid > 0 ? RoundRupee(full*(D-unpaid)/D) : full. */
export function prorate(full: MoneyInput, unpaidDays: MoneyInput, daysInPeriod: number): Decimal {
  const u = D(unpaidDays);
  if (u.lte(0)) return D(full);
  return roundRupee(D(full).times(D(daysInPeriod).minus(u)).div(daysInPeriod));
}

/** Day-weighted pay when an increment takes effect mid-month. Dates are 'YYYY-MM-DD'. */
export function blendByEffectiveDate(oldVal: MoneyInput, newVal: MoneyInput, eff: string, mStart: string, mEnd: string): Decimal {
  const e = dayNumber(eff);
  const s = dayNumber(mStart);
  const end = dayNumber(mEnd);
  if (e <= s) return D(newVal);
  if (e > end) return D(oldVal);
  const totalDays = end - s + 1;
  const daysOnAfter = end - e + 1;
  const daysBefore = totalDays - daysOnAfter;
  return roundRupee(D(oldVal).times(daysBefore).plus(D(newVal).times(daysOnAfter)).div(totalDays));
}

export interface TransferPosting {
  fromBranchId: number;
  toBranchId: number;
  joining: string; // 'YYYY-MM-DD'
}

/**
 * Split [mStart, mEnd] into (branch, days) segments from joining-dated transfers (ordered by joining asc).
 * Segment days always sum to the days in the month.
 */
export function branchDaySegments(
  transfers: TransferPosting[] | null | undefined,
  fallbackBranchId: number,
  mStart: string,
  mEnd: string,
): Array<{ branchId: number; days: number }> {
  const s = dayNumber(mStart);
  const e = dayNumber(mEnd);
  const totalDays = e - s + 1;
  if (!transfers || transfers.length === 0) return [{ branchId: fallbackBranchId, days: totalDays }];

  let opening = fallbackBranchId;
  let haveOpening = false;
  for (const t of transfers) {
    if (dayNumber(t.joining) <= s) {
      opening = t.toBranchId;
      haveOpening = true;
    }
  }
  if (!haveOpening) opening = transfers[0]!.fromBranchId;

  const segs: Array<{ branchId: number; days: number }> = [];
  let cur = opening;
  let segStart = s;
  for (const t of transfers) {
    const j = dayNumber(t.joining);
    if (j <= s || j > e) continue;
    const days = j - segStart;
    if (days > 0) segs.push({ branchId: cur, days });
    cur = t.toBranchId;
    segStart = j;
  }
  segs.push({ branchId: cur, days: e - segStart + 1 });
  return segs;
}

/** Drop paise, then raise to the next multiple of `step` (TNCU CeilTo10 with step = 10). */
export function ceilToStep(amount: MoneyInput, step: number = 10): Decimal {
  const whole = D(amount).floor();
  const rem = whole.mod(step);
  return rem.isZero() ? whole : whole.plus(D(step).minus(rem));
}

/** Regular increment amount: percent of present basic, rounded up to `step` (defaults: 3%, ₹10). */
export function incrementAmount(oldBasic: MoneyInput, percent: MoneyInput = 3, step: number = 10): Decimal {
  return ceilToStep(D(oldBasic).times(percent).div(100), step);
}

// ---- Gratuity (Payment of Gratuity Act §4) ----------------------------------------------------

function wholeMonths(from: string, to: string): number {
  const [fy, fm, fd] = from.split('-').map(Number) as [number, number, number];
  const [ty, tm, td] = to.split('-').map(Number) as [number, number, number];
  let months = (ty - fy) * 12 + tm - fm;
  if (td < fd) months--;
  return months < 0 ? 0 : months;
}

/** Completed years of actual service — the 5-year gate. */
export const gratuityActualYears = (from: string, to: string): number => Math.floor(wholeMonths(from, to) / 12);

/** Payable years: a remainder of ≥ 6 months counts as a full year. */
export function gratuityPayableYears(from: string, to: string): number {
  const m = wholeMonths(from, to);
  const y = Math.floor(m / 12);
  return m % 12 >= 6 ? y + 1 : y;
}

/** RoundRupee((Basic+DA) × 15/26 × years), capped at ceiling (0 = uncapped). */
export function gratuityAmount(wageBase: MoneyInput, payableYears: number, ceiling: MoneyInput = 0): { raw: Decimal; payable: Decimal } {
  const raw = roundRupee(D(wageBase).times(15).div(26).times(payableYears));
  const c = D(ceiling);
  return { raw, payable: c.gt(0) ? Decimal.min(raw, c) : raw };
}

/** Surrender leave salary / leave encashment: RoundRupee(total × days / 30). */
export const leaveSalary = (total: MoneyInput, days: MoneyInput): Decimal => roundRupee(D(total).times(days).div(30));

/** Format for JSON/DB: always 2 decimals as string. */
export const toMoneyString = (v: Decimal): string => v.toFixed(2);
