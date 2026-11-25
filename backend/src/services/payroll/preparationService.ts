/**
 * Payroll Preparation (specs/08-payroll-preparation.md §6, §9): prepare, approve, reject, reverse and withhold
 * the SALARY run of all employees of all branches.
 *
 *   OPEN ─Prepare→ PROCESSED ─Approve→ APPROVED ─(Payroll Periods: lock)→ LOCKED
 *                  PROCESSED ─Reject→ OPEN      APPROVED ─Reverse (Admin)→ PROCESSED
 *
 * Approve works the run out again and refuses if it differs from the saved bills, so nothing that changed after
 * Prepare — attendance, deductions, rates, assignments, postings — can be approved unseen.
 */
import { db } from '../../config/db';
import { actorName, withAudit, type Actor, type Tx } from '../../lib/dbContext';
import { AppError } from '../../lib/errors';
import { assertCanApprove, assertCanReject } from '../../lib/makerChecker';
import { D, toMoneyString, ZERO } from '../../lib/money';
import { ComponentCode as C, ComponentType } from '../../models/enums';
import type { PrepareInput, WithholdInput } from '../../models/payroll/preparation.schema';
import { logActivity } from '../core/activityLogService';
import type { Conn } from './finalisedPeriods';
import { periodLabel } from './hraCcaRules';
import { isEditable, lockForInput, lockPeriod } from './periodLock';
import * as periods from './periodService';
import { normaliseCode } from './payrollRules';
import { computeRun, type RunItem, type RunPeriod } from './payrollRunService';
import { payrollPrintOrder } from './printOrder';

const CHUNK = 500;
const chunks = <T>(list: T[]): T[][] => Array.from({ length: Math.ceil(list.length / CHUNK) }, (_, n) => list.slice(n * CHUNK, (n + 1) * CHUNK));

const event = (actor: Actor, trx: Tx, eventType: string, p: { id: number; month: number; calendar_year: number }, details?: unknown) =>
  logActivity(actor, { category: 'APPROVAL', eventType, module: 'payroll', entity: 'payroll_period', entityId: p.id, summary: `SALARY ${periodLabel(p)}`, details }, trx);

// ---------------------------------------------------------------- prepare
/** Employees of the run with no attendance entry: they are paid in full. */
async function withoutAttendance(c: Conn, periodId: number, items: RunItem[]) {
  const rows = await c.selectFrom('payroll.payroll_period_attendances').select('employee_id').where('payroll_period_id', '=', periodId).execute();
  const entered = new Set(rows.map((r) => r.employee_id));
  return items.filter((i) => !entered.has(i.employee.id)).length;
}

/** Prepare inside a transaction, so that Edit deductions can save and prepare as one. */
export async function prepareIn(trx: Tx, actor: Actor, periodId: number, confirmAttendance: boolean) {
  const p = await lockPeriod(trx, periodId);
  if (!isEditable(p)) throw AppError.conflict(`Only OPEN or PROCESSED periods can be (re)prepared (current status: ${p.payroll_status}).`);
  if (p.working_days === null) throw AppError.conflict('Set the Working Days for this payroll month before preparing payroll.');
  const final = await trx.selectFrom('payroll.payrolls').select('id').where('payroll_period_id', '=', periodId).where('payroll_status', '<>', 'DRAFT').executeTakeFirst();
  if (final) throw AppError.conflict('This period already has APPROVED or PAID pay bills. Reverse the approval first.');

  const { items } = await computeRun(trx, p);
  if (items.length === 0) throw AppError.conflict('No employee is in service in this period.');
  const missing = await withoutAttendance(trx, periodId, items);
  if (missing > 0 && !confirmAttendance)
    throw new AppError(409, `${missing} of ${items.length} employees have no attendance entry and will be paid in full.`, 'CONFIRM_ATTENDANCE', { missing, total: items.length });

  const withheld = new Map(
    (await trx.selectFrom('payroll.payrolls').select(['employee_id', 'withhold_reason']).where('payroll_period_id', '=', periodId).where('is_withheld', '=', true).execute())
      .map((r) => [r.employee_id, r.withhold_reason]),
  );
  await trx.deleteFrom('payroll.payrolls').where('payroll_period_id', '=', periodId).execute();

  const by = actorName(actor);
  const billIds = new Map<number, number>();
  for (const part of chunks(items)) {
    const ids = await trx
      .insertInto('payroll.payrolls')
      .values(
        part.map(({ employee: e, rule, bill }) => ({
          payroll_period_id: periodId,
          employee_id: e.id,
          working_days: bill.calendarDays,
          service_days: bill.serviceDays,
          payable_days: bill.payableDays.toFixed(2),
          gross_earnings: toMoneyString(bill.gross),
          total_deductions: toMoneyString(bill.deductions),
          net_salary: toMoneyString(bill.net),
          is_withheld: withheld.has(e.id),
          withhold_reason: withheld.get(e.id) ?? null,
          pay_type: p.payroll_type,
          branch_id: rule.branchId,
          financial_year_id: p.financial_year_id,
          issues: JSON.stringify(bill.issues),
          created_by: by,
        })),
      )
      .returning(['id', 'employee_id'])
      .execute();
    for (const r of ids) billIds.set(r.employee_id, r.id);
  }
  const lines = items.flatMap(({ employee: e, rule, bill }) =>
    bill.lines.map((l) => ({
      payroll_id: billIds.get(e.id)!,
      employee_id: e.id,
      component_id: l.component.id,
      allowance_amount: toMoneyString(l.allowance),
      deduction_amount: toMoneyString(l.deduction),
      branch_id: rule.branchId,
      financial_year_id: p.financial_year_id,
      applied: l.applied === null ? null : JSON.stringify(l.applied),
    })),
  );
  for (const part of chunks(lines)) await trx.insertInto('payroll.payroll_details').values(part).execute();

  // The maker is whoever prepared last: every bill is rebuilt.
  await trx
    .updateTable('payroll.payroll_periods')
    .set({ payroll_status: 'PROCESSED', processed_by: by, processed_at: new Date(), returned_by: null, returned_at: null, return_reason: null })
    .where('id', '=', periodId)
    .execute();
  const count = (s: 'ERROR' | 'WARNING') => items.reduce((n, i) => n + i.bill.issues.filter((x) => x.severity === s).length, 0);
  const result = { bills: items.length, lines: lines.length, errors: count('ERROR'), warnings: count('WARNING') };
  await event(actor, trx, 'SUBMITTED', p, result);
  return result;
}

export const prepare = (actor: Actor, i: PrepareInput) => withAudit(actor, (trx) => prepareIn(trx, actor, i.periodId, i.confirmAttendance));

// ---------------------------------------------------------------- has anything changed since Prepare?
const signature = (b: { branch: number; service: string; payable: string; lines: Array<[number, string, string]> }) =>
  JSON.stringify([b.branch, D(b.service).toString(), D(b.payable).toString(), b.lines.map(([c, a, d]) => [c, D(a).toString(), D(d).toString()]).sort()]);

/** Employees whose bill would come out differently now. */
async function changedSincePrepare(c: Conn, periodId: number, items: RunItem[]) {
  const [bills, details] = await Promise.all([
    c.selectFrom('payroll.payrolls').select(['id', 'employee_id', 'branch_id', 'service_days', 'payable_days']).where('payroll_period_id', '=', periodId).execute(),
    c
      .selectFrom('payroll.payroll_details as l')
      .innerJoin('payroll.payrolls as b', 'b.id', 'l.payroll_id')
      .select(['l.payroll_id', 'l.component_id', 'l.allowance_amount', 'l.deduction_amount'])
      .where('b.payroll_period_id', '=', periodId)
      .execute(),
  ]);
  const byBill = new Map<number, Array<[number, string, string]>>();
  for (const l of details) byBill.set(l.payroll_id, [...(byBill.get(l.payroll_id) ?? []), [l.component_id, l.allowance_amount, l.deduction_amount]]);
  const saved = new Map(
    bills.map((b) => [b.employee_id, signature({ branch: b.branch_id, service: b.service_days ?? '0', payable: b.payable_days ?? '0', lines: byBill.get(b.id) ?? [] })]),
  );
  const changed = items
    .filter(({ employee: e, rule, bill }) => {
      const now = signature({
        branch: rule.branchId, service: String(bill.serviceDays), payable: bill.payableDays.toString(),
        lines: bill.lines.map((l) => [l.component.id, l.allowance.toString(), l.deduction.toString()]),
      });
      const same = saved.get(e.id) === now;
      saved.delete(e.id);
      return !same;
    })
    .map(({ employee: e }) => ({ employeeId: e.id, employeeCode: e.employee_code, employeeName: e.employee_name }));
  if (saved.size > 0) {
    const gone = await c.selectFrom('hr.employees').select(['id', 'employee_code', 'employee_name']).where('id', 'in', [...saved.keys()]).execute();
    changed.push(...gone.map((e) => ({ employeeId: e.id, employeeCode: e.employee_code, employeeName: e.employee_name })));
  }
  return changed;
}

// ---------------------------------------------------------------- approve, reject, reverse
export async function approve(actor: Actor, periodId: number) {
  await withAudit(actor, async (trx) => {
    const p = await lockPeriod(trx, periodId);
    if (p.payroll_status === 'LOCKED') throw AppError.conflict('Payroll runs cannot be approved on LOCKED periods.');
    if (p.payroll_status !== 'PROCESSED') throw AppError.conflict('Prepare the payroll first — the period must be PROCESSED before it can be approved.');
    assertCanApprove(actor.user!, p.processed_by ?? '');
    const draft = await trx.selectFrom('payroll.payrolls').select('id').where('payroll_period_id', '=', periodId).where('payroll_status', '=', 'DRAFT').executeTakeFirst();
    if (!draft) throw AppError.conflict('No DRAFT payroll rows to approve.');

    const { items } = await computeRun(trx, p);
    const changed = await changedSincePrepare(trx, periodId, items);
    if (changed.length)
      throw new AppError(409, `Something changed after Prepare: ${changed.length} pay bill(s) would come out differently. Prepare the payroll again.`, 'STALE_RUN', { changed });
    const blocked = items.filter((i) => i.bill.issues.some((x) => x.severity === 'ERROR'));
    if (blocked.length)
      throw new AppError(409, `${blocked.length} employee(s) have errors. Correct them and prepare the payroll again.`, 'RUN_HAS_ERRORS', {
        employees: blocked.map(({ employee: e, bill }) => ({ employeeCode: e.employee_code, employeeName: e.employee_name, messages: bill.issues.filter((x) => x.severity === 'ERROR').map((x) => x.message) })),
      });

    const stamp = { approved_by: actorName(actor), approved_at: new Date() };
    await trx.updateTable('payroll.payrolls').set({ payroll_status: 'APPROVED', ...stamp }).where('payroll_period_id', '=', periodId).execute();
    await trx.updateTable('payroll.payroll_periods').set({ payroll_status: 'APPROVED', ...stamp }).where('id', '=', periodId).execute();
    await event(actor, trx, 'APPROVED', p, { bills: items.length });
  });
  return periods.get(periodId);
}

const returned = (actor: Actor, reason: string) => ({ returned_by: actorName(actor), returned_at: new Date(), return_reason: reason });

/** PROCESSED → OPEN. The draft bills stay until the next Prepare. */
export async function reject(actor: Actor, periodId: number, reason: string) {
  await withAudit(actor, async (trx) => {
    const p = await lockPeriod(trx, periodId);
    if (p.payroll_status !== 'PROCESSED') throw AppError.conflict(`Only PROCESSED periods can be rejected. Current status: ${p.payroll_status}`);
    assertCanReject(actor.user!, p.processed_by ?? '');
    await trx.updateTable('payroll.payroll_periods').set({ payroll_status: 'OPEN', ...returned(actor, reason) }).where('id', '=', periodId).execute();
    await event(actor, trx, 'REJECTED', p, { reason });
  });
  return periods.get(periodId);
}

/** APPROVED → PROCESSED while nothing is paid (Q9). Admin only, by the route. */
export async function reverse(actor: Actor, periodId: number, reason: string) {
  await withAudit(actor, async (trx) => {
    const p = await lockPeriod(trx, periodId);
    if (p.payroll_status !== 'APPROVED') throw AppError.conflict(`Only APPROVED periods can be reversed. Current status: ${p.payroll_status}`);
    const paid = await trx.selectFrom('payroll.payrolls').select('id').where('payroll_period_id', '=', periodId).where('payroll_status', '=', 'PAID').executeTakeFirst();
    if (paid) throw AppError.conflict('Pay bills of this period are already paid; the approval cannot be reversed.');
    const blank = { approved_by: null, approved_at: null };
    await trx.updateTable('payroll.payrolls').set({ payroll_status: 'DRAFT', ...blank }).where('payroll_period_id', '=', periodId).execute();
    await trx.updateTable('payroll.payroll_periods').set({ payroll_status: 'PROCESSED', ...blank, ...returned(actor, reason) }).where('id', '=', periodId).execute();
    await event(actor, trx, 'REVERSED', p, { reason });
  });
  return periods.get(periodId);
}

// ---------------------------------------------------------------- withhold
export async function withhold(actor: Actor, billId: number, i: WithholdInput) {
  await withAudit(actor, async (trx) => {
    const b = await trx.selectFrom('payroll.payrolls').select(['payroll_period_id']).where('id', '=', billId).executeTakeFirst();
    if (!b) throw AppError.notFound('Pay bill not found');
    const p = await lockPeriod(trx, b.payroll_period_id);
    if (p.payroll_status === 'LOCKED') throw AppError.conflict('The payroll period is locked; withhold status can no longer be changed.');
    const r = await trx
      .updateTable('payroll.payrolls')
      .set({ is_withheld: i.withheld, withhold_reason: i.withheld ? (i.reason ?? null) : null })
      .where('id', '=', billId)
      .where('payroll_status', '<>', 'PAID')
      .returning('id')
      .executeTakeFirst();
    if (!r) {
      const still = await trx.selectFrom('payroll.payrolls').select('id').where('id', '=', billId).executeTakeFirst();
      throw still ? AppError.conflict('This pay bill is already paid.') : AppError.notFound('The payroll was prepared again; refresh the page');
    }
    await event(actor, trx, i.withheld ? 'WITHHELD' : 'RELEASED', p, { payrollId: billId, reason: i.reason ?? null });
  });
  return bill(billId);
}

// ---------------------------------------------------------------- reads
const billRows = () =>
  db
    .selectFrom('payroll.payrolls as b')
    .innerJoin('hr.employees as e', 'e.id', 'b.employee_id')
    .innerJoin('hr.employee_designations as d', 'd.id', 'e.designation_id')
    .innerJoin('core.branches as br', 'br.id', 'b.branch_id')
    .select([
      'b.id', 'b.employee_id', 'e.employee_code', 'e.employee_name', 'd.designation_name', 'b.branch_id', 'br.name as branch_name', 'b.working_days', 'b.service_days', 'b.payable_days',
      'b.gross_earnings', 'b.total_deductions', 'b.net_salary', 'b.payroll_status', 'b.is_withheld', 'b.withhold_reason', 'b.issues', 'b.paid_on',
    ]);

const COLUMN: Record<string, string> = {
  [C.Basic]: 'basic', [C.PersonalPay]: 'pp', [C.GradePay]: 'gp', [C.SpecialPay]: 'sp', [C.DearnessAllowance]: 'da', [C.HouseRentAllowance]: 'hra',
  [C.CityCompensatoryAllowance]: 'cca', [C.MedicalAllowance]: 'ma', [C.ProvidentFund]: 'pf', [C.VoluntaryProvidentFund]: 'vpf',
};
const COLUMNS = ['basic', 'pp', 'gp', 'sp', 'pay', 'da', 'hra', 'cca', 'ma', 'employerPf', 'otherEarnings', 'pf', 'vpf', 'otherDeductions'] as const;

export async function grid(periodId: number) {
  const period = await periods.get(periodId);
  if (period.payroll_type !== 'SALARY') throw AppError.badRequest('Payroll Preparation is for SALARY periods only');
  const [rows, details] = await Promise.all([
    billRows().where('b.payroll_period_id', '=', periodId).orderBy(payrollPrintOrder).execute(),
    db
      .selectFrom('payroll.payroll_details as l')
      .innerJoin('payroll.payrolls as b', 'b.id', 'l.payroll_id')
      .innerJoin('payroll.payroll_components as c', 'c.id', 'l.component_id')
      .select(['l.payroll_id', 'l.allowance_amount', 'l.deduction_amount', 'c.component_code', 'c.component_type'])
      .where('b.payroll_period_id', '=', periodId)
      .execute(),
  ]);
  const amounts = new Map<number, Record<string, ReturnType<typeof D>>>();
  for (const l of details) {
    const a = amounts.get(l.payroll_id) ?? {};
    amounts.set(l.payroll_id, a);
    const code = normaliseCode(l.component_code);
    const add = (k: string, v: string) => { a[k] = (a[k] ?? ZERO).plus(v); };
    if (code === C.EmployerProvidentFund) add('employerPf', l.allowance_amount);
    else if (COLUMN[code]) add(COLUMN[code]!, l.component_type === ComponentType.Earnings ? l.allowance_amount : l.deduction_amount);
    else {
      add('otherEarnings', l.allowance_amount);
      add('otherDeductions', l.deduction_amount);
    }
    if (code === C.Basic || code === C.GradePay || code === C.SpecialPay) add('pay', l.allowance_amount);
  }
  const bills = rows.map((r) => ({ ...r, amounts: Object.fromEntries(COLUMNS.map((k) => [k, toMoneyString(amounts.get(r.id)?.[k] ?? ZERO)])) }));
  const changed = isEditable(period) && rows.length ? await changedSincePrepare(db, periodId, (await computeRun(db, period as RunPeriod)).items) : [];

  const group = (list: typeof rows) => ({ count: list.length, net: toMoneyString(list.reduce((s, b) => s.plus(b.net_salary), ZERO)) });
  return {
    period,
    bills,
    /** Employees whose bill would come out differently if payroll were prepared now. */
    changed,
    summary: {
      paid: group(rows.filter((b) => b.payroll_status === 'PAID')),
      pending: group(rows.filter((b) => b.payroll_status === 'APPROVED' && !b.is_withheld)),
      withheld: group(rows.filter((b) => b.is_withheld && b.payroll_status !== 'PAID')),
    },
  };
}

export async function bill(id: number) {
  const b = await billRows().where('b.id', '=', id).executeTakeFirst();
  if (!b) throw AppError.notFound('Pay bill not found');
  const lines = await db
    .selectFrom('payroll.payroll_details as l')
    .innerJoin('payroll.payroll_components as c', 'c.id', 'l.component_id')
    .select(['l.id', 'c.component_code', 'c.component_name', 'l.allowance_amount', 'l.deduction_amount', 'l.applied'])
    .where('l.payroll_id', '=', id)
    .orderBy('l.id')
    .execute();
  return { ...b, lines };
}
