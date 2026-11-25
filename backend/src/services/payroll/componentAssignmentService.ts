/**
 * Component assignments master (docs §3.1): what an employee is paid, or has deducted, under a component —
 * a fixed amount or a percentage, effective-dated. Active assignments of one employee and component never
 * overlap. Same change rules as the other dated masters (hraAmountService): Revise adds a successor row, and
 * once used in a finalised payroll the terms are fixed. There the end date can still be moved as long as no
 * finalised period is affected, because an assignment (Personal Pay, say) can simply stop.
 */
import { sql } from 'kysely';
import { db } from '../../config/db';
import { addDays, businessDate } from '../../lib/dates';
import { actorName, withAudit, type Actor, type Tx } from '../../lib/dbContext';
import { AppError } from '../../lib/errors';
import { ComponentCode, ComponentType } from '../../models/enums';
import type { AssignmentCreate, AssignmentQuery, AssignmentRevise, AssignmentUpdate } from '../../models/payroll/componentAssignment.schema';
import { finalisedPeriodOverlapping, type Conn } from './finalisedPeriods';
import { findOverlap, periodLabel, rateStatus } from './hraCcaRules';
import { payrollPrintOrder } from './printOrder';

const invalid = (field: string, msg: string) => new AppError(400, 'Validation failed', 'VALIDATION', { [field]: [msg] });

/** The column allows a blank start (a row loaded from elsewhere): it has always been in force. */
const startOf = (r: { effective_from: string | null }) => r.effective_from ?? '0001-01-01';
const dated = <T extends { effective_from: string | null }>(r: T) => ({ ...r, effective_from: startOf(r) });

const base = (c: Conn = db) =>
  c
    .selectFrom('payroll.payroll_component_assignments as a')
    .innerJoin('hr.employees as e', 'e.id', 'a.employee_id')
    .innerJoin('hr.employee_designations as d', 'd.id', 'e.designation_id')
    .innerJoin('payroll.payroll_components as c', 'c.id', 'a.component_id');

const rows = (c: Conn = db) =>
  base(c)
    .selectAll('a')
    .select(['e.employee_code', 'e.employee_name', 'd.designation_name', 'c.component_code', 'c.component_name', 'c.component_type']);

type Row = Awaited<ReturnType<ReturnType<typeof rows>['executeTakeFirstOrThrow']>>;
type Terms = Omit<AssignmentRevise, 'effectiveFrom'>;

const statusSql = (asOn: string) => sql<string>`case when not a.is_active then 'INACTIVE'
  when a.effective_from > ${asOn}::date then 'FUTURE'
  when a.effective_to < ${asOn}::date then 'EXPIRED' else 'CURRENT' end`;

// ---------------------------------------------------------------- reads
export async function list(q: AssignmentQuery) {
  const asOn = q.asOn ?? businessDate();
  const conds = [sql`true`];
  if (q.employeeId) conds.push(sql`a.employee_id = ${q.employeeId}`);
  if (q.componentId) conds.push(sql`a.component_id = ${q.componentId}`);
  if (q.status && q.status !== 'ALL') conds.push(sql`${statusSql(asOn)} = ${q.status}`);
  if (q.search) {
    const term = `%${q.search.replace(/[%_\\]/g, '\\$&')}%`;
    conds.push(sql`(e.employee_code ilike ${term} or e.employee_name ilike ${term})`);
  }
  const where = sql<boolean>`${sql.join(conds, sql` and `)}`;
  const [items, total] = await Promise.all([
    rows()
      .select(statusSql(asOn).as('status'))
      .where(where)
      .orderBy(payrollPrintOrder)
      .orderBy(sql`c.display_order asc nulls last`)
      .orderBy('c.component_code')
      .orderBy(sql`a.effective_from desc nulls last`)
      .orderBy('a.id', 'desc')
      .limit(q.size)
      .offset((q.page - 1) * q.size)
      .execute(),
    base().select((eb) => eb.fn.countAll<string>().as('n')).where(where).executeTakeFirstOrThrow(),
  ]);
  return { asOn, page: q.page, size: q.size, total: Number(total.n), items };
}

const finalisedUse = (c: Conn, r: { effective_from: string | null; effective_to: string | null }) =>
  finalisedPeriodOverlapping(c, startOf(r), r.effective_to);

export async function get(id: number) {
  const r = await rows().where('a.id', '=', id).executeTakeFirst();
  if (!r) throw AppError.notFound('Component assignment not found');
  return { ...r, status: rateStatus(dated(r), businessDate()), usedInFinalisedPayroll: !!(await finalisedUse(db, r)) };
}

// ---------------------------------------------------------------- rules
const FIXED_ONLY = new Set<string>([ComponentCode.Basic, ComponentCode.PersonalPay, ComponentCode.GradePay, ComponentCode.SpecialPay]);

/** A percentage the calculator would ignore (docs §3.3 rules 1 and 8) is refused instead of paying nothing. */
function assertTypeAllowed(c: { component_code: string; component_name: string; component_type: number }, i: Terms) {
  if (i.assignedType !== 'PERCENTAGE') return;
  const code = c.component_code.trim().toUpperCase();
  const deduction = c.component_type !== ComponentType.Earnings && code !== ComponentCode.VoluntaryProvidentFund;
  if (FIXED_ONLY.has(code) || deduction) throw invalid('assignedType', `${c.component_name} must be a fixed amount.`);
}

/** Dates that cover a finalised period: refused, unless the user may back-date (Admin) → warning. */
async function checkFinalised(trx: Tx, actor: Actor, from: string, to: string | null): Promise<string[]> {
  const p = await finalisedPeriodOverlapping(trx, from, to);
  if (!p) return [];
  if (!actor.user?.isAdmin) throw invalid('effectiveFrom', `These dates cover a finalised period (${periodLabel(p)}).`);
  return [`The dates cover the finalised period ${periodLabel(p)}; arrears will be needed for finalised months.`];
}

async function assertNoOverlap(trx: Tx, key: { employee_id: number; component_id: number }, from: string, to: string | null, exceptId?: number) {
  // The employee row is the lock: two entries made at the same moment cannot both pass the check below.
  await trx.selectFrom('hr.employees').select('id').where('id', '=', key.employee_id).forNoKeyUpdate().execute();
  const others = await rows(trx)
    .where('a.is_active', '=', true)
    .where('a.employee_id', '=', key.employee_id)
    .where('a.component_id', '=', key.component_id)
    .execute();
  const o = findOverlap(from, to, others.map(dated), exceptId);
  if (!o) return;
  const start = others.find((x) => x.id === o.id)!.effective_from ?? 'the beginning';
  throw invalid('effectiveFrom', `Overlaps with the ${o.component_name} assignment from ${start} to ${o.effective_to ?? 'open'} for ${o.employee_name}.`);
}

// ---------------------------------------------------------------- writes
const values = (i: Terms) => ({
  assigned_type: i.assignedType,
  assigned_amount: i.assignedAmount,
  percentage: i.percentage,
  minimum_amount: i.minimumAmount,
  maximum_amount: i.maximumAmount,
});

async function insert(trx: Tx, actor: Actor, key: { employee_id: number; component_id: number }, i: Terms, from: string, to: string | null) {
  await assertNoOverlap(trx, key, from, to);
  const row = await trx
    .insertInto('payroll.payroll_component_assignments')
    .values({ employee_id: key.employee_id, component_id: key.component_id, ...values(i), effective_from: from, effective_to: to, is_active: true, created_by: actorName(actor) })
    .returning('id')
    .executeTakeFirstOrThrow();
  return row.id;
}

async function lockActive(trx: Tx, id: number, action: string) {
  const r = await rows(trx).where('a.id', '=', id).forUpdate('a').executeTakeFirst();
  if (!r) throw AppError.notFound('Component assignment not found');
  if (!r.is_active) throw AppError.conflict(`This assignment is inactive and cannot be ${action}.`);
  return r;
}

const set = (trx: Tx, id: number, cols: Partial<ReturnType<typeof values>> & { effective_from?: string | null; effective_to?: string | null; is_active?: boolean }) =>
  trx.updateTable('payroll.payroll_component_assignments').set(cols).where('id', '=', id).execute();

/** Nothing would ever be paid on an assignment that starts after the employee left. */
function assertBeforeLeaving(e: { date_of_leaving: string | null }, from: string | null) {
  if (from && e.date_of_leaving && from > e.date_of_leaving) throw invalid('effectiveFrom', `The employee left on ${e.date_of_leaving}.`);
}
const leavingDate = (trx: Tx, id: number) => trx.selectFrom('hr.employees').select('date_of_leaving').where('id', '=', id).executeTakeFirst();

export async function create(actor: Actor, i: AssignmentCreate) {
  const { id, warnings } = await withAudit(actor, async (trx) => {
    const e = await leavingDate(trx, i.employeeId);
    if (!e) throw invalid('employeeId', 'Select an employee.');
    const c = await trx.selectFrom('payroll.payroll_components').selectAll().where('id', '=', i.componentId).executeTakeFirst();
    if (!c || !c.is_active) throw invalid('componentId', 'Select a component.');
    assertTypeAllowed(c, i);
    assertBeforeLeaving(e, i.effectiveFrom);
    const to = i.effectiveTo ?? null;
    const warnings = await checkFinalised(trx, actor, i.effectiveFrom, to);
    return { id: await insert(trx, actor, { employee_id: i.employeeId, component_id: i.componentId }, i, i.effectiveFrom, to), warnings };
  });
  return { ...(await get(id)), warnings };
}

const sameTerms = (r: Row, i: AssignmentUpdate) =>
  r.effective_from === i.effectiveFrom && r.assigned_type === i.assignedType &&
  Number(r.assigned_amount) === i.assignedAmount && Number(r.percentage) === i.percentage &&
  Number(r.minimum_amount) === i.minimumAmount && Number(r.maximum_amount) === i.maximumAmount;

/** A used row ends earlier or later: only dates after every finalised period may be affected. */
async function moveEnd(trx: Tx, r: Row, to: string | null) {
  if (to === r.effective_to) return;
  const [first, last] = r.effective_to === null ? [to!, null] : to === null ? [r.effective_to, null] : [to, r.effective_to].sort();
  const p = await finalisedPeriodOverlapping(trx, addDays(first!, 1), last ?? null);
  if (p) throw invalid('effectiveTo', `This would change a finalised period (${periodLabel(p)}).`);
  await assertNoOverlap(trx, r, startOf(r), to, r.id);
  await set(trx, r.id, { effective_to: to });
}

export async function update(actor: Actor, id: number, i: AssignmentUpdate) {
  const warnings = await withAudit(actor, async (trx) => {
    const r = await lockActive(trx, id, 'edited');
    const to = i.effectiveTo ?? null;
    if (await finalisedUse(trx, r)) {
      if (!sameTerms(r, i))
        throw AppError.conflict('This assignment has been used in a finalised payroll. Only the end date can be changed; use Revise to change the amount.');
      await moveEnd(trx, r, to);
      return [];
    }
    if (i.effectiveFrom === null && r.effective_from !== null) throw invalid('effectiveFrom', 'Enter a date');
    assertTypeAllowed(r, i);
    assertBeforeLeaving((await leavingDate(trx, r.employee_id))!, i.effectiveFrom);
    const from = startOf({ effective_from: i.effectiveFrom });
    const warnings = await checkFinalised(trx, actor, from, to);
    await assertNoOverlap(trx, r, from, to, id);
    await set(trx, id, { ...values(i), effective_from: i.effectiveFrom, effective_to: to });
    return warnings;
  });
  return { ...(await get(id)), warnings };
}

/** Successor row from `effectiveFrom`; the current row is closed the day before, in one transaction. */
export async function revise(actor: Actor, id: number, i: AssignmentRevise) {
  const { newId, warnings } = await withAudit(actor, async (trx) => {
    const r = await lockActive(trx, id, 'revised');
    assertTypeAllowed(r, i);
    assertBeforeLeaving((await leavingDate(trx, r.employee_id))!, i.effectiveFrom);
    if (i.effectiveFrom <= startOf(r))
      throw invalid('effectiveFrom', `The revision must start after ${r.effective_from}, when the current assignment starts.`);
    const closeOn = addDays(i.effectiveFrom, -1);
    const closes = r.effective_to === null || r.effective_to > closeOn;
    const successorTo = closes ? r.effective_to : null; // a bounded assignment keeps its end date on the successor
    const warnings = await checkFinalised(trx, actor, i.effectiveFrom, successorTo);
    if (closes) await set(trx, r.id, { effective_to: closeOn });
    return { newId: await insert(trx, actor, r, i, i.effectiveFrom, successorTo), warnings };
  });
  return { ...(await get(newId)), warnings };
}

/** Soft delete; blocked once used in a finalised payroll. */
export async function deactivate(actor: Actor, id: number) {
  await withAudit(actor, async (trx) => {
    const r = await lockActive(trx, id, 'deactivated');
    if (await finalisedUse(trx, r))
      throw AppError.conflict('This assignment has been used in a finalised payroll and cannot be deactivated. Enter an end date, or use Revise to replace it.');
    await set(trx, id, { is_active: false });
  });
}
