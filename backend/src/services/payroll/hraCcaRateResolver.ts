/**
 * HraCcaRateResolver (spec §4.1) — the single lookup that every caller (payroll compute, salary preview,
 * arrears, payslip) must use to pick an employee's HRA/CCA rate.
 *
 *   basis = app setting `payroll.hra_cca.basis` in force on the date
 *   PLACE       → branch held on the date → branch's place category
 *   DESIGNATION → designation held on the date
 *   rate        = active row of that basis and key with from ≤ date ≤ to (or open), latest from first
 *
 * A missing rate is returned as `found: false`, never as 0% — payroll validation must flag it (§4.3).
 */
import { db } from '../../config/db';
import { daysInclusive } from '../../lib/dates';
import { AppError } from '../../lib/errors';
import { keyDaySegments, type KeyChange } from '../../lib/money';
import type { HraCcaBasis } from '../../models/db.types';
import { basisOn } from './hraCcaBasisService';
import { keyAsOn } from './hraCcaRules';

export interface HraCcaRateParts {
  percent: string;
  minAmount: string;
  maxAmount: string; // '0.00' = no cap
}

export type ResolvedHraCcaRate =
  | { found: true; rateId: number; basis: HraCcaBasis; keyId: number; keyName: string; asOn: string; effectiveFrom: string; effectiveTo: string | null; hra: HraCcaRateParts; cca: HraCcaRateParts }
  | { found: false; basis: HraCcaBasis; keyId: number | null; keyName: string; asOn: string; message: string };

async function employeeRow(employeeId: number) {
  const e = await db
    .selectFrom('hr.employees')
    .select(['id', 'branch_id', 'designation_id'])
    .where('id', '=', employeeId)
    .executeTakeFirst();
  if (!e) throw AppError.notFound('Employee not found');
  return e;
}

/** Joining-dated transfers, oldest first (TNCU: segments follow the joining date). */
async function branchChanges(employeeId: number): Promise<KeyChange<number>[]> {
  const rows = await db
    .selectFrom('hr.employee_transfers')
    .select(['from_branch_id', 'to_branch_id', 'joining_date'])
    .where('employee_id', '=', employeeId)
    .where('is_active', '=', true)
    .where('joining_date', 'is not', null)
    .orderBy('joining_date')
    .orderBy('id')
    .execute();
  return rows.map((r) => ({ from: r.from_branch_id, to: r.to_branch_id, on: r.joining_date! }));
}

/** Approved promotions/reversions, oldest first; the change takes effect on effect_date (else promotion_date). */
async function designationChanges(employeeId: number): Promise<KeyChange<number>[]> {
  const rows = await db
    .selectFrom('hr.employee_promotions')
    .select(['from_designation_id', 'to_designation_id', 'promotion_date', 'effect_date'])
    .where('employee_id', '=', employeeId)
    .where('status', '=', 'APPROVED')
    .execute();
  return rows
    .map((r) => ({ from: r.from_designation_id, to: r.to_designation_id, on: r.effect_date ?? r.promotion_date }))
    .sort((a, b) => (a.on < b.on ? -1 : a.on > b.on ? 1 : 0));
}

async function placeOfBranch(branchId: number): Promise<number | null> {
  const b = await db.selectFrom('core.branches').select('place_id').where('id', '=', branchId).executeTakeFirst();
  return b?.place_id ?? null;
}

async function keyName(basis: HraCcaBasis, keyId: number | null): Promise<string> {
  if (keyId === null) return 'Branch has no place category';
  if (basis === 'PLACE') return (await db.selectFrom('core.place_categories').select('name').where('id', '=', keyId).executeTakeFirst())?.name ?? `Place #${keyId}`;
  return (await db.selectFrom('hr.employee_designations').select('designation_name').where('id', '=', keyId).executeTakeFirst())?.designation_name ?? `Designation #${keyId}`;
}

/** Active rate row for a basis + key on a date. */
export async function rateFor(basis: HraCcaBasis, keyId: number, asOn: string) {
  return db
    .selectFrom('payroll.payroll_hra_cca_rates')
    .selectAll()
    .where('is_active', '=', true)
    .where('rate_basis', '=', basis)
    .where(basis === 'PLACE' ? 'place_id' : 'designation_id', '=', keyId)
    .where('effective_from', '<=', asOn)
    .where((eb) => eb.or([eb('effective_to', 'is', null), eb('effective_to', '>=', asOn)]))
    .orderBy('effective_from', 'desc')
    .executeTakeFirst();
}

async function resolveKey(basis: HraCcaBasis, employeeId: number, keyId: number | null, asOn: string): Promise<ResolvedHraCcaRate> {
  const name = await keyName(basis, keyId);
  const r = keyId === null ? undefined : await rateFor(basis, keyId, asOn);
  if (!r) {
    const what = basis === 'PLACE' ? (keyId === null ? name : `Place ${name}`) : `Designation ${name}`;
    return { found: false, basis, keyId, keyName: name, asOn, message: `No HRA/CCA rate for ${what} as on ${asOn}` };
  }
  return {
    found: true,
    rateId: r.id,
    basis,
    keyId: keyId!,
    keyName: name,
    asOn,
    effectiveFrom: r.effective_from,
    effectiveTo: r.effective_to,
    hra: { percent: r.hra_percentage, minAmount: r.hra_minimum_amount, maxAmount: r.hra_maximum_amount },
    cca: { percent: r.cca_percentage, minAmount: r.cca_minimum_amount, maxAmount: r.cca_maximum_amount },
  };
}

/** Key (place category or designation id) the employee held on `asOn` under `basis`. */
export async function keyOn(basis: HraCcaBasis, employeeId: number, asOn: string): Promise<number | null> {
  const e = await employeeRow(employeeId);
  if (basis === 'DESIGNATION') return keyAsOn(e.designation_id, await designationChanges(employeeId), asOn);
  return placeOfBranch(keyAsOn(e.branch_id, await branchChanges(employeeId), asOn));
}

/** HraCcaRateResolver.Resolve(employeeId, date). */
export async function resolve(employeeId: number, asOn: string): Promise<ResolvedHraCcaRate> {
  const basis = await basisOn(asOn);
  return resolveKey(basis, employeeId, await keyOn(basis, employeeId, asOn), asOn);
}

/**
 * Per-segment resolution for a pay period (spec §4.2): the month is split by transfer joining dates
 * (PLACE) or promotion effect dates (DESIGNATION), as TNCU splits HRA/CCA by branch-day segments.
 * Each segment's rate is the one valid on the period end date (rate revisions inside a period are
 * not prorated; back-dated revisions go through arrears).
 */
export async function resolveSegments(employeeId: number, from: string, to: string) {
  const basis = await basisOn(to);
  const e = await employeeRow(employeeId);
  const totalDays = daysInclusive(from, to);
  let segs: Array<{ keyId: number | null; days: number; branchId?: number }>;
  if (basis === 'DESIGNATION') {
    segs = keyDaySegments(await designationChanges(employeeId), e.designation_id, from, to).map((g) => ({ keyId: g.key, days: g.days }));
  } else {
    const bySeg = keyDaySegments(await branchChanges(employeeId), e.branch_id, from, to);
    segs = await Promise.all(bySeg.map(async (g) => ({ keyId: await placeOfBranch(g.key), days: g.days, branchId: g.key })));
  }
  return {
    basis,
    totalDays,
    segments: await Promise.all(segs.map(async (s) => ({ ...s, rate: await resolveKey(basis, employeeId, s.keyId, to) }))),
  };
}
