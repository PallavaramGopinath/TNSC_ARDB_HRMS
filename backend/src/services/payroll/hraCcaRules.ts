/**
 * Pure rules for HRA/CCA rates and the calculation basis (specs/01-hra-cca-rates-calculation-basis.md),
 * and the HRA method that replaced the single basis (specs/06 §12): the method decides HRA only; CCA always
 * goes by place.
 * No database access here, so every rule is unit-tested in tests/hraCcaRules.test.ts.
 */
import { addDays, monthBounds } from '../../lib/dates';
import type { KeyChange } from '../../lib/money';
import type { HraCcaBasis, HraMethod } from '../../models/db.types';

export const HRA_CCA_BASIS_KEY = 'payroll.hra_cca.basis';
export const HraCcaBases = ['PLACE', 'DESIGNATION'] as const satisfies readonly HraCcaBasis[];
export const basisLabel = (b: HraCcaBasis) => (b === 'PLACE' ? 'Place of posting' : 'Designation');

export const HraMethods = [...HraCcaBases, 'FIXED_AMOUNT'] as const satisfies readonly HraMethod[];
export const methodLabel = (m: HraMethod) => (m === 'FIXED_AMOUNT' ? 'Fixed amount by designation and place' : basisLabel(m));
export const parseMethod = (v: unknown): HraMethod => HraMethods.find((m) => m === v) ?? 'PLACE';

/** PLACE rows always carry the CCA rates; DESIGNATION rows matter only while HRA goes by designation. */
export const isBasisInUse = (basis: HraCcaBasis, method: HraMethod) => basis === 'PLACE' || basis === method;

export type RateStatus = 'CURRENT' | 'FUTURE' | 'EXPIRED' | 'INACTIVE';

/** Status of a rate row against the "As on" date (spec §5.2). */
export function rateStatus(r: { is_active: boolean; effective_from: string; effective_to: string | null }, asOn: string): RateStatus {
  if (!r.is_active) return 'INACTIVE';
  if (r.effective_from > asOn) return 'FUTURE';
  if (r.effective_to !== null && r.effective_to < asOn) return 'EXPIRED';
  return 'CURRENT';
}

export interface DatedRange {
  id: number;
  effective_from: string;
  effective_to: string | null;
}

/** First active range (same key) overlapping [from, to] (to null = open-ended), ignoring `exceptId`. */
export function findOverlap<T extends DatedRange>(from: string, to: string | null, others: T[], exceptId?: number): T | undefined {
  return others.find(
    (o) => o.id !== exceptId && (to === null || o.effective_from <= to) && (o.effective_to === null || o.effective_to >= from),
  );
}

/**
 * Key (branch or designation) held on `asOn`, given the current key and the dated changes that led to it.
 * The employee record holds the latest key; if a change happens after `asOn`, the key on `asOn` is the
 * `from` of the earliest such change.
 */
export function keyAsOn<K>(current: K, changes: KeyChange<K>[], asOn: string): K {
  const later = changes.filter((c) => c.on > asOn).sort((a, b) => (a.on < b.on ? -1 : a.on > b.on ? 1 : 0));
  return later.length ? later[0]!.from : current;
}

export interface PeriodState {
  from_date: string;
  to_date: string;
  month: number;
  calendar_year: number;
  payroll_type: string;
  payroll_status: string;
  bill_count: number;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const periodLabel = (p: { month: number; calendar_year: number }) => `${MONTHS[p.month - 1]} ${p.calendar_year}`;

/**
 * When can the HRA method change, and from which date (spec §4.4)?
 *  - Blocked while any period is APPROVED but not yet LOCKED: its bills are final and must not be paid on
 *    another method. Reverse the approval first.
 *  - An OPEN or PROCESSED run does not block. Its draft bills keep the old HRA until it is prepared again;
 *    Approve works the run out again and refuses a stale run, so the old HRA cannot be approved unseen.
 *    `reprepare` names such a run, so the screen can say to prepare it again.
 *  - Takes effect from the earliest SALARY period not yet LOCKED; else the day after the last LOCKED
 *    SALARY period; else (nothing run yet) the first day of the business month.
 */
export interface ChangeWindow {
  canChange: boolean;
  blockedReason: string | null;
  effectiveFrom: string;
  /** Unapproved runs that already have pay bills (e.g. "Nov 2026"): prepare them again after a change. */
  reprepare: string[];
}

export function basisChangeWindow(periods: PeriodState[], today: string): ChangeWindow {
  const byFrom = (a: PeriodState, b: PeriodState) => (a.from_date < b.from_date ? -1 : 1);
  const approved = periods.filter((p) => p.payroll_status === 'APPROVED').sort(byFrom);
  const drafts = periods.filter((p) => (p.payroll_status === 'OPEN' || p.payroll_status === 'PROCESSED') && p.bill_count > 0).sort(byFrom);
  const salary = periods.filter((p) => p.payroll_type === 'SALARY');
  const pending = salary.filter((p) => p.payroll_status !== 'LOCKED').sort((a, b) => (a.from_date < b.from_date ? -1 : 1));
  const locked = salary.filter((p) => p.payroll_status === 'LOCKED').sort((a, b) => (a.to_date > b.to_date ? -1 : 1));

  let effectiveFrom: string;
  if (pending.length) effectiveFrom = pending[0]!.from_date;
  else if (locked.length) effectiveFrom = addDays(locked[0]!.to_date, 1);
  else {
    const [y, m] = today.split('-').map(Number) as [number, number];
    effectiveFrom = monthBounds(y, m).from;
  }

  const blocker = approved[0];
  return {
    canChange: !blocker,
    blockedReason: blocker
      ? `The ${periodLabel(blocker)} ${blocker.payroll_type === 'SALARY' ? 'payroll' : blocker.payroll_type.replace(/_/g, ' ')} run is approved. Lock it, or reverse the approval, before changing the HRA method.`
      : null,
    effectiveFrom,
    reprepare: drafts.map((p) => (p.payroll_type === 'SALARY' ? periodLabel(p) : `${periodLabel(p)} ${p.payroll_type.replace(/_/g, ' ')}`)),
  };
}
