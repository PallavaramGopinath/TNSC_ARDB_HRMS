/**
 * HraCcaRateResolver (specs/01 §4.1, specs/06 §5–6) — the single lookup that every caller (payroll compute,
 * allowance preview, arrears, payslip) must use to find what an employee's HRA and CCA are paid on.
 *
 *   HRA: by the method (app setting `payroll.hra_cca.basis`) in force on the period end date
 *        PLACE        → % row of the place category of the branch held
 *        DESIGNATION  → % row of the designation held
 *        FIXED_AMOUNT → amount of the designation held, for the place category of the branch held
 *   CCA: always the % row of the place category of the branch held
 *
 * The period is split by transfer joining dates and approved promotion effect dates (TNCU splits HRA/CCA into
 * branch-day segments). Each segment uses the row valid on the period end date: rate revisions inside a
 * period are not prorated; back-dated revisions go through arrears.
 *
 * A missing row comes back as kind MISSING, never as 0 — payroll validation must flag it (specs/01 §4.3).
 */
import { db } from '../../config/db';
import { daysInclusive } from '../../lib/dates';
import { AppError } from '../../lib/errors';
import type { KeyChange } from '../../lib/money';
import type { HraCcaBasis, HraMethod } from '../../models/db.types';
import { hraAmountFor, intersectSegments, segmentsFor, type AllowanceRule, type AllowanceSegment } from './allowanceRules';
import { methodOn } from './hraCcaBasisService';

export interface PostedEmployee {
  id: number;
  branch_id: number;
  designation_id: number;
}

const pushTo = <V>(m: Map<number, V[]>, k: number, v: V) => void (m.get(k)?.push(v) ?? m.set(k, [v]));
const byDate = (a: { on: string }, b: { on: string }) => (a.on < b.on ? -1 : a.on > b.on ? 1 : 0);

/** Joining-dated transfers (TNCU: segments follow the joining date), oldest first. */
async function branchChanges(employeeIds: number[]) {
  const out = new Map<number, KeyChange<number>[]>();
  const rows = await db
    .selectFrom('hr.employee_transfers')
    .select(['employee_id', 'from_branch_id', 'to_branch_id', 'joining_date'])
    .where('employee_id', 'in', employeeIds)
    .where('is_active', '=', true)
    .where('joining_date', 'is not', null)
    .orderBy('joining_date')
    .orderBy('id')
    .execute();
  for (const r of rows) pushTo(out, r.employee_id, { from: r.from_branch_id, to: r.to_branch_id, on: r.joining_date! });
  return out;
}

/** Approved promotions/reversions, oldest first; the change takes effect on effect_date (else promotion_date). */
async function designationChanges(employeeIds: number[]) {
  const out = new Map<number, KeyChange<number>[]>();
  const rows = await db
    .selectFrom('hr.employee_promotions')
    .select(['employee_id', 'from_designation_id', 'to_designation_id', 'promotion_date', 'effect_date'])
    .where('employee_id', 'in', employeeIds)
    .where('status', '=', 'APPROVED')
    .orderBy('id')
    .execute();
  for (const r of rows) pushTo(out, r.employee_id, { from: r.from_designation_id, to: r.to_designation_id, on: r.effect_date ?? r.promotion_date });
  for (const list of out.values()) list.sort(byDate);
  return out;
}

/** Active percentage rows in force on a date, by basis and key. */
async function ratesOn(asOn: string) {
  const rows = await db
    .selectFrom('payroll.payroll_hra_cca_rates')
    .selectAll()
    .where('is_active', '=', true)
    .where('effective_from', '<=', asOn)
    .where((eb) => eb.or([eb('effective_to', 'is', null), eb('effective_to', '>=', asOn)]))
    .execute();
  return new Map(rows.map((r) => [`${r.rate_basis}:${r.rate_basis === 'PLACE' ? r.place_id : r.designation_id}`, r]));
}

async function hraAmountsOn(asOn: string) {
  const rows = await db
    .selectFrom('payroll.payroll_hra_amounts')
    .selectAll()
    .where('is_active', '=', true)
    .where('effective_from', '<=', asOn)
    .where((eb) => eb.or([eb('effective_to', 'is', null), eb('effective_to', '>=', asOn)]))
    .execute();
  return new Map(rows.map((r) => [r.designation_id, r]));
}

export interface ResolvedAllowances {
  method: HraMethod;
  totalDays: number;
  hra: AllowanceSegment[];
  cca: AllowanceSegment[];
  /** Designation and branch held on the period end date. */
  designation: string;
  branch: string;
  place: string | null;
}

/** Rules for a pay period, for many employees at once (a fixed number of queries whatever the count). */
export async function resolveMany(employees: PostedEmployee[], from: string, to: string): Promise<Map<number, ResolvedAllowances>> {
  const out = new Map<number, ResolvedAllowances>();
  if (!employees.length) return out;
  const ids = employees.map((e) => e.id);
  const [method, transfers, promotions, rates, amounts, branchRows, designationRows] = await Promise.all([
    methodOn(to),
    branchChanges(ids),
    designationChanges(ids),
    ratesOn(to),
    hraAmountsOn(to),
    db
      .selectFrom('core.branches as b')
      .leftJoin('core.place_categories as p', 'p.id', 'b.place_id')
      .select(['b.id', 'b.name', 'b.place_id', 'p.code as place_code', 'p.name as place_name'])
      .execute(),
    db.selectFrom('hr.employee_designations').select(['id', 'designation_name']).execute(),
  ]);
  const branches = new Map(branchRows.map((b) => [b.id, b]));
  const designations = new Map(designationRows.map((d) => [d.id, d.designation_name]));
  const noPlace = (what: 'HRA' | 'CCA', branchId: number) => `No ${what}: branch ${branches.get(branchId)!.name} has no place category`;

  const percentRule = (what: 'HRA' | 'CCA', basis: HraCcaBasis, branchId: number, designationId: number): AllowanceRule => {
    const branch = branches.get(branchId)!;
    if (basis === 'PLACE' && branch.place_id === null) return { kind: 'MISSING', message: noPlace(what, branchId) };
    const label = basis === 'PLACE' ? branch.place_name! : designations.get(designationId)!;
    const r = rates.get(`${basis}:${basis === 'PLACE' ? branch.place_id : designationId}`);
    if (!r) return { kind: 'MISSING', message: `No ${what} rate for ${basis === 'PLACE' ? 'Place' : 'Designation'} ${label} as on ${to}` };
    return what === 'HRA'
      ? { kind: 'PERCENT', rowId: r.id, label, percent: r.hra_percentage, minAmount: r.hra_minimum_amount, maxAmount: r.hra_maximum_amount }
      : { kind: 'PERCENT', rowId: r.id, label, percent: r.cca_percentage, minAmount: r.cca_minimum_amount, maxAmount: r.cca_maximum_amount };
  };
  const hraRule = (branchId: number, designationId: number): AllowanceRule => {
    if (method !== 'FIXED_AMOUNT') return percentRule('HRA', method, branchId, designationId);
    const label = designations.get(designationId)!;
    const row = amounts.get(designationId);
    if (!row) return { kind: 'MISSING', message: `No HRA amount for Designation ${label} as on ${to}` };
    const amount = hraAmountFor(row, branches.get(branchId)!.place_code);
    return amount ? { kind: 'FIXED', rowId: row.id, label, amount: amount.toString() } : { kind: 'MISSING', message: noPlace('HRA', branchId) };
  };

  for (const e of employees) {
    const byBranch = segmentsFor(e.branch_id, transfers.get(e.id) ?? [], from, to);
    const byDesignation = segmentsFor(e.designation_id, promotions.get(e.id) ?? [], from, to);
    const last = branches.get(byBranch[byBranch.length - 1]!.key)!;
    out.set(e.id, {
      method,
      totalDays: daysInclusive(from, to),
      hra: intersectSegments(byDesignation, byBranch).map((s) => ({ key: hraRule(s.key.b, s.key.a), days: s.days })),
      cca: byBranch.map((s) => ({ key: percentRule('CCA', 'PLACE', s.key, e.designation_id), days: s.days })),
      designation: designations.get(byDesignation[byDesignation.length - 1]!.key)!,
      branch: last.name,
      place: last.place_name,
    });
  }
  return out;
}

/** HraCcaRateResolver.Resolve(employeeId, date): what applies to one employee on one day. */
export async function resolve(employeeId: number, asOn: string) {
  const e = await db.selectFrom('hr.employees').select(['id', 'branch_id', 'designation_id']).where('id', '=', employeeId).executeTakeFirst();
  if (!e) throw AppError.notFound('Employee not found');
  const r = (await resolveMany([e], asOn, asOn)).get(e.id)!;
  return { asOn, method: r.method, designation: r.designation, branch: r.branch, place: r.place, hra: r.hra[0]!.key, cca: r.cca[0]!.key };
}
