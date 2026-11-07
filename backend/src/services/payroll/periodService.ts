/**
 * Payroll periods — port of TNCU TNCU.Business/Payroll/PayrollPeriodService.cs.
 *
 * ARDB (guarded status flow): no manual status transitions here. OPEN → PROCESSED → APPROVED (and reject
 * back to OPEN) happen only through Payroll Preparation. This service locks only via lockAndOpenNext,
 * which refuses while approved, non-withheld bills are unpaid.
 */
import { sql } from 'kysely';
import { db } from '../../config/db';
import { daysInclusive, monthBounds } from '../../lib/dates';
import { actorName, withAudit, type Actor, type Tx } from '../../lib/dbContext';
import { AppError } from '../../lib/errors';
import type { PeriodInput, PeriodQuery } from '../../models/payroll/period.schema';
import { daRates } from './daRateService';

const invalid = (field: string, msg: string) => new AppError(400, 'Validation failed', 'VALIDATION', { [field]: [msg] });

const base = () =>
  db
    .selectFrom('payroll.payroll_periods as p')
    .innerJoin('core.branches as b', 'b.id', 'p.branch_id')
    .innerJoin('core.financial_years as fy', 'fy.id', 'p.financial_year_id')
    .selectAll('p')
    .select([
      'b.name as branch_name',
      'b.code as branch_code',
      'fy.short_code as fy_short_code',
      sql<number>`(select count(*)::int from payroll.payrolls x where x.payroll_period_id = p.id)`.as('bill_count'),
      sql<number>`(select count(*)::int from payroll.payrolls x where x.payroll_period_id = p.id and x.payroll_status = 'APPROVED' and not x.is_withheld)`.as('unpaid_count'),
      sql<number>`(p.to_date - p.from_date + 1)`.as('total_days'),
    ]);

export async function list(q: PeriodQuery) {
  let query = base();
  if (q.status) query = query.where('p.payroll_status', '=', q.status);
  if (q.payrollType) query = query.where('p.payroll_type', '=', q.payrollType);
  if (q.calendarYear) query = query.where('p.calendar_year', '=', q.calendarYear);
  if (q.month) query = query.where('p.month', '=', q.month);
  return query.orderBy('p.calendar_year', 'desc').orderBy('p.month', 'desc').orderBy('p.payroll_type').limit(500).execute();
}

export async function get(id: number) {
  const row = await base().where('p.id', '=', id).executeTakeFirst();
  if (!row) throw AppError.notFound('Payroll period not found');
  return row;
}

async function fyFor(trx: Tx, date: string) {
  const fy = await trx
    .selectFrom('core.financial_years')
    .select(['id', 'short_code', 'is_closed'])
    .where('start_date', '<=', date)
    .where('end_date', '>=', date)
    .executeTakeFirst();
  if (!fy) throw invalid('fromDate', `No financial year covers ${date}. Create the financial year first.`);
  if (fy.is_closed) throw invalid('fromDate', `Financial year ${fy.short_code} is closed`);
  return fy;
}

async function assertNoClash(trx: Tx, i: PeriodInput, fyId: number, exceptId?: number) {
  let q = trx
    .selectFrom('payroll.payroll_periods')
    .select('id')
    .where('branch_id', '=', i.branchId)
    .where('financial_year_id', '=', fyId)
    .where('month', '=', i.month)
    .where('payroll_type', '=', i.payrollType);
  if (exceptId) q = q.where('id', '<>', exceptId);
  if (await q.executeTakeFirst()) throw invalid('month', `A ${i.payrollType} period already exists for this branch, month and financial year`);
}

async function assertBranch(trx: Tx, branchId: number) {
  const b = await trx.selectFrom('core.branches').select('is_active').where('id', '=', branchId).executeTakeFirst();
  if (!b) throw invalid('branchId', 'Branch not found');
}

const columns = (i: PeriodInput) => ({
  month: i.month,
  calendar_year: i.calendarYear,
  from_date: i.fromDate,
  to_date: i.toDate,
  payroll_type: i.payrollType,
  da_rate: i.daRate,
  arrear_from_date: i.arrearFromDate ?? null,
  arrear_to_date: i.arrearToDate ?? null,
  branch_id: i.branchId,
});

export async function create(actor: Actor, i: PeriodInput) {
  const id = await withAudit(actor, async (trx) => {
    await assertBranch(trx, i.branchId);
    const fy = await fyFor(trx, i.fromDate);
    await assertNoClash(trx, i, fy.id);
    const row = await trx
      .insertInto('payroll.payroll_periods')
      .values({ ...columns(i), payroll_status: 'OPEN', is_active: true, financial_year_id: fy.id, created_by: actorName(actor) })
      .returning('id')
      .executeTakeFirstOrThrow();
    return row.id;
  });
  return get(id);
}

async function lockOpen(trx: Tx, id: number, action: string) {
  const p = await trx.selectFrom('payroll.payroll_periods').selectAll().where('id', '=', id).forUpdate().executeTakeFirst();
  if (!p) throw AppError.notFound('Payroll period not found');
  if (p.payroll_status !== 'OPEN') throw AppError.conflict(`Only OPEN periods can be ${action}. This period is ${p.payroll_status}.`);
  return p;
}

export async function update(actor: Actor, id: number, i: PeriodInput) {
  await withAudit(actor, async (trx) => {
    await lockOpen(trx, id, 'edited');
    await assertBranch(trx, i.branchId);
    const fy = await fyFor(trx, i.fromDate);
    await assertNoClash(trx, i, fy.id, id);
    await trx.updateTable('payroll.payroll_periods').set({ ...columns(i), financial_year_id: fy.id }).where('id', '=', id).execute();
  });
  return get(id);
}

export async function remove(actor: Actor, id: number) {
  await withAudit(actor, async (trx) => {
    await lockOpen(trx, id, 'deleted');
    const bills = await trx.selectFrom('payroll.payrolls').select('id').where('payroll_period_id', '=', id).executeTakeFirst();
    if (bills) throw AppError.conflict('This period has pay bills and cannot be deleted');
    await trx.deleteFrom('payroll.payroll_periods').where('id', '=', id).execute();
  });
}

export async function setWorkingDays(actor: Actor, id: number, workingDays: number | null) {
  await withAudit(actor, async (trx) => {
    const p = await trx.selectFrom('payroll.payroll_periods').selectAll().where('id', '=', id).forUpdate().executeTakeFirst();
    if (!p) throw AppError.notFound('Payroll period not found');
    if (p.payroll_status !== 'OPEN' && p.payroll_status !== 'PROCESSED')
      throw AppError.conflict('Working days can only be set while the period is OPEN or PROCESSED');
    const total = daysInclusive(p.from_date, p.to_date);
    if (workingDays !== null && workingDays > total) throw invalid('workingDays', `Working days must be between 0 and ${total}`);
    await trx.updateTable('payroll.payroll_periods').set({ working_days: workingDays }).where('id', '=', id).execute();
  });
  return get(id);
}

/** Lock an APPROVED SALARY period and make sure next month's SALARY period exists (TNCU LockAndOpenNextAsync). */
export async function lockAndOpenNext(actor: Actor, id: number) {
  const nextId = await withAudit(actor, async (trx) => {
    const p = await trx.selectFrom('payroll.payroll_periods').selectAll().where('id', '=', id).forUpdate().executeTakeFirst();
    if (!p) throw AppError.notFound('Payroll period not found');
    if (p.payroll_type !== 'SALARY') throw AppError.conflict('Only SALARY periods support lock and open next');
    if (p.payroll_status !== 'APPROVED') throw AppError.conflict(`Only APPROVED periods can be locked. This period is ${p.payroll_status}.`);

    const unpaid = await trx
      .selectFrom('payroll.payrolls')
      .select((eb) => eb.fn.countAll<string>().as('n'))
      .where('payroll_period_id', '=', id)
      .where('payroll_status', '=', 'APPROVED')
      .where('is_withheld', '=', false)
      .executeTakeFirstOrThrow();
    if (Number(unpaid.n) > 0)
      throw AppError.conflict(`${unpaid.n} approved pay bill(s) are still unpaid. Mark them paid before locking the period.`);

    await trx
      .updateTable('payroll.payroll_periods')
      .set({ payroll_status: 'LOCKED', locked_by: actorName(actor), locked_at: new Date() })
      .where('id', '=', id)
      .execute();

    // Ensure next month's SALARY period at HO (TNCU EnsureOpenSalaryPeriodAsync).
    const [nm, ny] = p.month >= 12 ? [1, p.calendar_year + 1] : [p.month + 1, p.calendar_year];
    const existing = await trx
      .selectFrom('payroll.payroll_periods')
      .select('id')
      .where('payroll_type', '=', 'SALARY')
      .where('month', '=', nm)
      .where('calendar_year', '=', ny)
      .orderBy('id')
      .executeTakeFirst();
    if (existing) return existing.id;

    const ho = await trx.selectFrom('core.branches').select('id').where('type', '=', 'HO').orderBy('is_active', 'desc').executeTakeFirst();
    if (!ho) throw AppError.conflict('No Head Office branch is configured; a SALARY period needs an HO anchor branch');
    const { from, to } = monthBounds(ny, nm);
    const fy = await fyFor(trx, from).catch(() => {
      throw AppError.conflict(`No open financial year covers ${from}. Create it before opening the next payroll month.`);
    });
    const da = await daRates.rateOn(to);
    const row = await trx
      .insertInto('payroll.payroll_periods')
      .values({
        month: nm, calendar_year: ny, from_date: from, to_date: to, payroll_type: 'SALARY', payroll_status: 'OPEN',
        da_rate: da?.percentage ?? 0, is_active: true, branch_id: ho.id, financial_year_id: fy.id, created_by: actorName(actor),
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    return row.id;
  });
  return { locked: await get(id), next: await get(nextId) };
}
