/**
 * HRA & CCA rates master (spec §3.2, §5.2–5.5, §6). One table serves both bases; every row says which
 * key it uses (rate_basis). New rows always take the organisation's active basis; rows of the other basis
 * stay for history and are read-only.
 *
 * Edit/deactivate are refused once a rate overlaps a finalised (APPROVED/LOCKED) payroll period — only
 * remarks stay editable and changes go through Revise. When the payroll calculator stores the applied
 * rate id on each pay line, swap usedInFinalisedPayroll for that reference.
 */
import { sql } from 'kysely';
import { db } from '../../config/db';
import { addDays, businessDate } from '../../lib/dates';
import { actorName, withAudit, type Actor, type Tx } from '../../lib/dbContext';
import { AppError } from '../../lib/errors';
import type { HraCcaBasis } from '../../models/db.types';
import type {
  HraCcaBulkRevise,
  HraCcaRateCreate,
  HraCcaRateQuery,
  HraCcaRateRevise,
  HraCcaRateUpdate,
} from '../../models/payroll/hraCca.schema';
import { activeBasis, coverage } from './hraCcaBasisService';
import { basisLabel, findOverlap, periodLabel, rateStatus } from './hraCcaRules';

const invalid = (field: string, msg: string) => new AppError(400, 'Validation failed', 'VALIDATION', { [field]: [msg] });
type Conn = Tx | typeof db;

const base = (c: Conn = db) =>
  c
    .selectFrom('payroll.payroll_hra_cca_rates as r')
    .leftJoin('core.place_categories as pc', 'pc.id', 'r.place_id')
    .leftJoin('hr.employee_designations as d', 'd.id', 'r.designation_id')
    .selectAll('r')
    .select(sql<string>`coalesce(pc.name, d.designation_name)`.as('key_name'));

type RateRow = Awaited<ReturnType<ReturnType<typeof base>['executeTakeFirstOrThrow']>>;

const keyIdOf = (r: { rate_basis: HraCcaBasis; place_id: number | null; designation_id: number | null }) =>
  (r.rate_basis === 'PLACE' ? r.place_id : r.designation_id)!;

const statusSql = (asOn: string) => sql<string>`case when not r.is_active then 'INACTIVE'
  when r.effective_from > ${asOn}::date then 'FUTURE'
  when r.effective_to is not null and r.effective_to < ${asOn}::date then 'EXPIRED' else 'CURRENT' end`;

// ---------------------------------------------------------------- finalised-payroll checks
/** A finalised (APPROVED or LOCKED) payroll period overlapping [from, to]. */
async function finalisedPeriodOverlapping(c: Conn, from: string, to: string | null) {
  return c
    .selectFrom('payroll.payroll_periods')
    .select(['id', 'month', 'calendar_year', 'from_date', 'to_date'])
    .where('payroll_status', 'in', ['APPROVED', 'LOCKED'])
    .where('is_active', '=', true)
    .where('to_date', '>=', from)
    .$if(to !== null, (q) => q.where('from_date', '<=', to!))
    .orderBy('from_date', 'desc')
    .executeTakeFirst();
}

const usedInFinalisedPayroll = async (c: Conn, r: { effective_from: string; effective_to: string | null }) =>
  !!(await finalisedPeriodOverlapping(c, r.effective_from, r.effective_to));

/** Effective-from inside a finalised period: refused, unless the user may back-date (Admin) → warning. */
async function checkBackdate(c: Conn, actor: Actor, from: string): Promise<string[]> {
  const p = await finalisedPeriodOverlapping(c, from, from);
  if (!p) return [];
  if (!actor.user?.isAdmin) throw invalid('effectiveFrom', `This date is in a finalised period (${periodLabel(p)}).`);
  return [`Effective-from falls in the finalised period ${periodLabel(p)}; arrears will be needed for finalised months.`];
}

// ---------------------------------------------------------------- keys
async function assertKey(c: Conn, basis: HraCcaBasis, keyId: number) {
  if (basis === 'PLACE') {
    const p = await c.selectFrom('core.place_categories').select(['is_active']).where('id', '=', keyId).executeTakeFirst();
    if (!p || !p.is_active) throw invalid('placeId', 'Select a place.');
  } else {
    const d = await c.selectFrom('hr.employee_designations').select(['is_active']).where('id', '=', keyId).executeTakeFirst();
    if (!d || !d.is_active) throw invalid('designationId', 'Select a designation.');
  }
}

/** Key from the request body, checked against the organisation's active basis (spec §6: wrong key → 400). */
function keyFromBody(basis: HraCcaBasis, b: { placeId?: number; designationId?: number }): number {
  if (basis === 'PLACE') {
    if (b.designationId != null || b.placeId == null)
      throw invalid('placeId', 'HRA/CCA rates are applied by place of posting for this organisation; send placeId only.');
    return b.placeId;
  }
  if (b.placeId != null || b.designationId == null)
    throw invalid('designationId', 'HRA/CCA rates are applied by designation for this organisation; send designationId only.');
  return b.designationId;
}

async function assertNoOverlap(c: Conn, basis: HraCcaBasis, keyId: number, from: string, to: string | null, exceptId?: number) {
  const others = await base(c)
    .where('r.is_active', '=', true)
    .where('r.rate_basis', '=', basis)
    .where(basis === 'PLACE' ? 'r.place_id' : 'r.designation_id', '=', keyId)
    .forUpdate('r')
    .execute();
  const o = findOverlap(from, to, others, exceptId);
  if (o) {
    const range = `${o.effective_from} to ${o.effective_to ?? 'open'}`;
    throw invalid('effectiveFrom', `Overlaps with rate effective ${range} for ${o.key_name}.`);
  }
}

// ---------------------------------------------------------------- reads
export async function list(q: HraCcaRateQuery) {
  const active = await activeBasis();
  const basis = q.basis ?? active;
  const asOn = q.asOn ?? businessDate();
  let query = base()
    .select(statusSql(asOn).as('status'))
    .where('r.rate_basis', '=', basis);
  if (basis === 'PLACE' && q.placeId) query = query.where('r.place_id', '=', q.placeId);
  if (basis === 'DESIGNATION' && q.designationId) query = query.where('r.designation_id', '=', q.designationId);
  if (q.status && q.status !== 'ALL') query = query.where(statusSql(asOn), '=', q.status);
  if (q.search) query = query.where(sql<string>`coalesce(pc.name, d.designation_name)`, 'ilike', `%${q.search.replace(/[%_\\]/g, '\\$&')}%`);

  const total = await db
    .selectFrom(query.as('x'))
    .select((eb) => eb.fn.countAll<string>().as('n'))
    .executeTakeFirstOrThrow();
  const items = await query
    .orderBy(sql`coalesce(pc.display_order, d.seniority_order, 999)`)
    .orderBy('key_name')
    .orderBy('r.effective_from', 'desc')
    .orderBy('r.id', 'desc')
    .limit(q.size)
    .offset((q.page - 1) * q.size)
    .execute();
  return { basis, activeBasis: active, readOnly: basis !== active, asOn, page: q.page, size: q.size, total: Number(total.n), items };
}

export async function get(id: number) {
  const r = await base().where('r.id', '=', id).executeTakeFirst();
  if (!r) throw AppError.notFound('HRA/CCA rate not found');
  const active = await activeBasis();
  return {
    ...r,
    status: rateStatus(r, businessDate()),
    usedInFinalisedPayroll: await usedInFinalisedPayroll(db, r),
    readOnly: r.rate_basis !== active,
  };
}

/** Serving employees mapped now to a place (via branch) or designation (spec §5.3 "Employees affected now"). */
export async function affectedEmployees(q: { placeId?: number; designationId?: number }) {
  const today = businessDate();
  let query = db
    .selectFrom('hr.employees as e')
    .innerJoin('core.branches as b', 'b.id', 'e.branch_id')
    .select((eb) => eb.fn.countAll<string>().as('n'))
    .where((eb) => eb.or([eb('e.date_of_leaving', 'is', null), eb('e.date_of_leaving', '>=', today)]));
  if (q.placeId) query = query.where('b.place_id', '=', q.placeId);
  else if (q.designationId) query = query.where('e.designation_id', '=', q.designationId);
  else return { count: 0 };
  return { count: Number((await query.executeTakeFirstOrThrow()).n) };
}

export async function missing(asOn?: string) {
  return coverage(await activeBasis(), asOn ?? businessDate());
}

// ---------------------------------------------------------------- writes
const values = (i: Omit<HraCcaRateRevise, 'effectiveFrom'>) => ({
  hra_percentage: i.hraPercent,
  hra_minimum_amount: i.hraMinAmount,
  hra_maximum_amount: i.hraMaxAmount,
  cca_percentage: i.ccaPercent,
  cca_minimum_amount: i.ccaMinAmount,
  cca_maximum_amount: i.ccaMaxAmount,
});

async function insertRate(
  trx: Tx,
  actor: Actor,
  basis: HraCcaBasis,
  keyId: number,
  i: Omit<HraCcaRateRevise, 'effectiveFrom'> & { effectiveFrom: string; effectiveTo?: string | null },
) {
  await assertNoOverlap(trx, basis, keyId, i.effectiveFrom, i.effectiveTo ?? null);
  const row = await trx
    .insertInto('payroll.payroll_hra_cca_rates')
    .values({
      rate_basis: basis,
      place_id: basis === 'PLACE' ? keyId : null,
      designation_id: basis === 'DESIGNATION' ? keyId : null,
      effective_from: i.effectiveFrom,
      effective_to: i.effectiveTo ?? null,
      ...values(i),
      remarks: i.remarks ?? null,
      is_active: true,
      created_by: actorName(actor),
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  return row.id;
}

/** Load a row for change: must exist, be active, and belong to the active basis. */
async function lockEditable(trx: Tx, id: number, action: string) {
  const r = await base(trx).where('r.id', '=', id).forUpdate('r').executeTakeFirst();
  if (!r) throw AppError.notFound('HRA/CCA rate not found');
  if (!r.is_active) throw AppError.conflict(`This rate is inactive and cannot be ${action}.`);
  const active = await activeBasis();
  if (r.rate_basis !== active)
    throw AppError.conflict(`This is a ${basisLabel(r.rate_basis)} rate; the organisation now uses ${basisLabel(active)}. It can be viewed but not ${action}.`);
  return r;
}

export async function create(actor: Actor, i: HraCcaRateCreate) {
  const basis = await activeBasis();
  const keyId = keyFromBody(basis, i);
  const { id, warnings } = await withAudit(actor, async (trx) => {
    await assertKey(trx, basis, keyId);
    const warnings = await checkBackdate(trx, actor, i.effectiveFrom);
    return { id: await insertRate(trx, actor, basis, keyId, i), warnings };
  });
  return { ...(await get(id)), warnings };
}

const sameMoney = (a: string, b: number) => Number(a) === b;
const sameRow = (r: RateRow, i: HraCcaRateUpdate) =>
  r.effective_from === i.effectiveFrom &&
  (r.effective_to ?? null) === (i.effectiveTo ?? null) &&
  sameMoney(r.hra_percentage, i.hraPercent) && sameMoney(r.hra_minimum_amount, i.hraMinAmount) && sameMoney(r.hra_maximum_amount, i.hraMaxAmount) &&
  sameMoney(r.cca_percentage, i.ccaPercent) && sameMoney(r.cca_minimum_amount, i.ccaMinAmount) && sameMoney(r.cca_maximum_amount, i.ccaMaxAmount);

export async function update(actor: Actor, id: number, i: HraCcaRateUpdate) {
  const warnings = await withAudit(actor, async (trx) => {
    const r = await lockEditable(trx, id, 'edited');
    const who = actorName(actor);
    if (await usedInFinalisedPayroll(trx, r)) {
      if (!sameRow(r, i))
        throw AppError.conflict('This rate has been used in a finalised payroll. Only remarks can be edited; use Revise to change the rate.');
      await trx.updateTable('payroll.payroll_hra_cca_rates').set({ remarks: i.remarks ?? null, updated_by: who, updated_at: new Date() }).where('id', '=', id).execute();
      return [];
    }
    const warnings = await checkBackdate(trx, actor, i.effectiveFrom);
    await assertNoOverlap(trx, r.rate_basis, keyIdOf(r), i.effectiveFrom, i.effectiveTo ?? null, id);
    await trx
      .updateTable('payroll.payroll_hra_cca_rates')
      .set({ effective_from: i.effectiveFrom, effective_to: i.effectiveTo ?? null, ...values(i), remarks: i.remarks ?? null, updated_by: who, updated_at: new Date() })
      .where('id', '=', id)
      .execute();
    return warnings;
  });
  return { ...(await get(id)), warnings };
}

/** Successor row from `effectiveFrom`; the current row is closed the day before, in one transaction. */
async function reviseIn(trx: Tx, actor: Actor, r: RateRow, i: HraCcaRateRevise) {
  if (i.effectiveFrom <= r.effective_from)
    throw invalid('effectiveFrom', `The revision must start after ${r.effective_from}, when the current rate for ${r.key_name} starts.`);
  const closeOn = addDays(i.effectiveFrom, -1);
  let successorTo: string | null = null;
  if (r.effective_to === null || r.effective_to > closeOn) {
    successorTo = r.effective_to; // a bounded rate keeps its end date on the successor
    await trx
      .updateTable('payroll.payroll_hra_cca_rates')
      .set({ effective_to: closeOn, updated_by: actorName(actor), updated_at: new Date() })
      .where('id', '=', r.id)
      .execute();
  }
  return insertRate(trx, actor, r.rate_basis, keyIdOf(r), { ...i, effectiveTo: successorTo });
}

export async function revise(actor: Actor, id: number, i: HraCcaRateRevise) {
  const { newId, warnings } = await withAudit(actor, async (trx) => {
    const r = await lockEditable(trx, id, 'revised');
    const warnings = await checkBackdate(trx, actor, i.effectiveFrom);
    return { newId: await reviseIn(trx, actor, r, i), warnings };
  });
  return { ...(await get(newId)), warnings };
}

/**
 * Bulk revision (spec §5.5): for each changed key, revise its rate in force on the new date (or add one if
 * the key has none). All or nothing.
 */
export async function bulkRevise(actor: Actor, i: HraCcaBulkRevise) {
  const basis = await activeBasis();
  const keyCol = basis === 'PLACE' ? ('r.place_id' as const) : ('r.designation_id' as const);
  const result = await withAudit(actor, async (trx) => {
    const warnings = await checkBackdate(trx, actor, i.effectiveFrom);
    const created: number[] = [];
    const seen = new Set<number>();
    for (const item of i.items) {
      if (seen.has(item.keyId)) throw invalid('items', 'Each place or designation can appear only once');
      seen.add(item.keyId);
      await assertKey(trx, basis, item.keyId);
      const values = { ...item, effectiveFrom: i.effectiveFrom, remarks: item.remarks ?? i.remarks ?? null };
      const current = await base(trx)
        .where('r.is_active', '=', true)
        .where('r.rate_basis', '=', basis)
        .where(keyCol, '=', item.keyId)
        .where('r.effective_from', '<', i.effectiveFrom)
        .where((eb) => eb.or([eb('r.effective_to', 'is', null), eb('r.effective_to', '>=', addDays(i.effectiveFrom, -1))]))
        .orderBy('r.effective_from', 'desc')
        .forUpdate('r')
        .executeTakeFirst();
      created.push(current ? await reviseIn(trx, actor, current, values) : await insertRate(trx, actor, basis, item.keyId, values));
    }
    return { created, warnings };
  });
  return { basis, effectiveFrom: i.effectiveFrom, createdIds: result.created, count: result.created.length, warnings: result.warnings };
}

/** Soft delete (spec §5.2); blocked once used in a finalised payroll. */
export async function deactivate(actor: Actor, id: number) {
  await withAudit(actor, async (trx) => {
    const r = await lockEditable(trx, id, 'deactivated');
    if (await usedInFinalisedPayroll(trx, r))
      throw AppError.conflict('This rate has been used in a finalised payroll and cannot be deactivated. Use Revise to replace it.');
    await trx
      .updateTable('payroll.payroll_hra_cca_rates')
      .set({ is_active: false, updated_by: actorName(actor), updated_at: new Date() })
      .where('id', '=', id)
      .execute();
  });
}
