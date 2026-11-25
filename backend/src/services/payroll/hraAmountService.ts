/**
 * Fixed HRA amounts master (specs/06 §5, §12.1): per designation, one monthly amount for Greater Chennai
 * Corporation and one for every other place category, effective-dated. Used when the HRA method is
 * FIXED_AMOUNT, but can be entered before the switch. Same change rules as the percentage rates
 * (hraCcaRateService): no overlaps; once used in a finalised payroll only remarks can be edited.
 */
import { sql } from 'kysely';
import { db } from '../../config/db';
import { addDays, businessDate } from '../../lib/dates';
import { actorName, withAudit, type Actor, type Tx } from '../../lib/dbContext';
import { AppError } from '../../lib/errors';
import type { HraAmountCreate, HraAmountQuery, HraAmountRevise, HraAmountUpdate } from '../../models/payroll/hraAmount.schema';
import { checkBackdate, usedInFinalisedPayroll, type Conn } from './finalisedPeriods';
import { coverage, nextPeriodStart } from './hraCcaBasisService';
import { findOverlap, rateStatus } from './hraCcaRules';

const invalid = (field: string, msg: string) => new AppError(400, 'Validation failed', 'VALIDATION', { [field]: [msg] });

const base = (c: Conn = db) =>
  c
    .selectFrom('payroll.payroll_hra_amounts as a')
    .innerJoin('hr.employee_designations as d', 'd.id', 'a.designation_id')
    .selectAll('a')
    .select('d.designation_name');

type Row = Awaited<ReturnType<ReturnType<typeof base>['executeTakeFirstOrThrow']>>;

// ---------------------------------------------------------------- reads
export async function list(q: HraAmountQuery) {
  const asOn = q.asOn ?? businessDate();
  let query = base();
  if (q.designationId) query = query.where('a.designation_id', '=', q.designationId);
  if (q.search) query = query.where('d.designation_name', 'ilike', `%${q.search.replace(/[%_\\]/g, '\\$&')}%`);
  const rows = await query
    .orderBy(sql`d.seniority_order asc nulls last`)
    .orderBy('d.designation_name')
    .orderBy('a.effective_from', 'desc')
    .orderBy('a.id', 'desc')
    .execute();
  const items = rows.map((r) => ({ ...r, status: rateStatus(r, asOn) }));
  return { asOn, items: q.status && q.status !== 'ALL' ? items.filter((r) => r.status === q.status) : items };
}

export async function get(id: number) {
  const r = await base().where('a.id', '=', id).executeTakeFirst();
  if (!r) throw AppError.notFound('HRA amount not found');
  return { ...r, status: rateStatus(r, businessDate()), usedInFinalisedPayroll: await usedInFinalisedPayroll(db, r) };
}

/** Designations with serving employees but no amount (and branches without a place category). */
export async function missing(asOn?: string) {
  const c = await coverage('FIXED_AMOUNT', asOn ?? (await nextPeriodStart()));
  return { asOn: c.asOn, ...c.hra };
}

// ---------------------------------------------------------------- writes
async function assertNoOverlap(trx: Tx, designationId: number, from: string, to: string | null, exceptId?: number) {
  const others = await base(trx).where('a.is_active', '=', true).where('a.designation_id', '=', designationId).forUpdate('a').execute();
  const o = findOverlap(from, to, others, exceptId);
  if (o) throw invalid('effectiveFrom', `Overlaps with the amount effective ${o.effective_from} to ${o.effective_to ?? 'open'} for ${o.designation_name}.`);
}

const values = (i: HraAmountRevise) => ({ gcc_amount: i.gccAmount, other_amount: i.otherAmount, effective_from: i.effectiveFrom, remarks: i.remarks ?? null });

async function insert(trx: Tx, actor: Actor, designationId: number, i: HraAmountRevise & { effectiveTo?: string | null }) {
  await assertNoOverlap(trx, designationId, i.effectiveFrom, i.effectiveTo ?? null);
  const row = await trx
    .insertInto('payroll.payroll_hra_amounts')
    .values({ designation_id: designationId, ...values(i), effective_to: i.effectiveTo ?? null, is_active: true, created_by: actorName(actor) })
    .returning('id')
    .executeTakeFirstOrThrow();
  return row.id;
}

async function lockActive(trx: Tx, id: number, action: string) {
  const r = await base(trx).where('a.id', '=', id).forUpdate('a').executeTakeFirst();
  if (!r) throw AppError.notFound('HRA amount not found');
  if (!r.is_active) throw AppError.conflict(`This amount is inactive and cannot be ${action}.`);
  return r;
}

const touch = (trx: Tx, actor: Actor, id: number, set: Partial<{ gcc_amount: number; other_amount: number; effective_from: string; effective_to: string | null; remarks: string | null; is_active: boolean }>) =>
  trx.updateTable('payroll.payroll_hra_amounts').set({ ...set, updated_by: actorName(actor), updated_at: new Date() }).where('id', '=', id).execute();

export async function create(actor: Actor, i: HraAmountCreate) {
  const { id, warnings } = await withAudit(actor, async (trx) => {
    const d = await trx.selectFrom('hr.employee_designations').select('is_active').where('id', '=', i.designationId).executeTakeFirst();
    if (!d || !d.is_active) throw invalid('designationId', 'Select a designation.');
    const warnings = await checkBackdate(trx, actor, i.effectiveFrom);
    return { id: await insert(trx, actor, i.designationId, i), warnings };
  });
  return { ...(await get(id)), warnings };
}

const sameTerms = (r: Row, i: HraAmountUpdate) =>
  r.effective_from === i.effectiveFrom && r.effective_to === (i.effectiveTo ?? null) &&
  Number(r.gcc_amount) === i.gccAmount && Number(r.other_amount) === i.otherAmount;

export async function update(actor: Actor, id: number, i: HraAmountUpdate) {
  const warnings = await withAudit(actor, async (trx) => {
    const r = await lockActive(trx, id, 'edited');
    if (await usedInFinalisedPayroll(trx, r)) {
      if (!sameTerms(r, i))
        throw AppError.conflict('This amount has been used in a finalised payroll. Only remarks can be edited; use Revise to change the amount.');
      await touch(trx, actor, id, { remarks: i.remarks ?? null });
      return [];
    }
    const warnings = await checkBackdate(trx, actor, i.effectiveFrom);
    await assertNoOverlap(trx, r.designation_id, i.effectiveFrom, i.effectiveTo ?? null, id);
    await touch(trx, actor, id, { ...values(i), effective_to: i.effectiveTo ?? null });
    return warnings;
  });
  return { ...(await get(id)), warnings };
}

/** Successor row from `effectiveFrom`; the current row is closed the day before, in one transaction. */
export async function revise(actor: Actor, id: number, i: HraAmountRevise) {
  const { newId, warnings } = await withAudit(actor, async (trx) => {
    const r = await lockActive(trx, id, 'revised');
    const warnings = await checkBackdate(trx, actor, i.effectiveFrom);
    if (i.effectiveFrom <= r.effective_from)
      throw invalid('effectiveFrom', `The revision must start after ${r.effective_from}, when the current amount for ${r.designation_name} starts.`);
    const closeOn = addDays(i.effectiveFrom, -1);
    let successorTo: string | null = null;
    if (r.effective_to === null || r.effective_to > closeOn) {
      successorTo = r.effective_to; // a bounded amount keeps its end date on the successor
      await touch(trx, actor, r.id, { effective_to: closeOn });
    }
    return { newId: await insert(trx, actor, r.designation_id, { ...i, effectiveTo: successorTo }), warnings };
  });
  return { ...(await get(newId)), warnings };
}

/** Soft delete; blocked once used in a finalised payroll. */
export async function deactivate(actor: Actor, id: number) {
  await withAudit(actor, async (trx) => {
    const r = await lockActive(trx, id, 'deactivated');
    if (await usedInFinalisedPayroll(trx, r))
      throw AppError.conflict('This amount has been used in a finalised payroll and cannot be deactivated. Use Revise to replace it.');
    await touch(trx, actor, id, { is_active: false });
  });
}
