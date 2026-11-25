/**
 * Monthly attendance of a SALARY period (specs/08 §5.1): HQ, camp and days of each leave type. An employee with
 * no entry is paid in full. Whole days only (Q6). Leave balances are not debited here.
 */
import { db } from '../../config/db';
import { daysInclusive } from '../../lib/dates';
import { actorName, withAudit, type Actor, type Tx } from '../../lib/dbContext';
import { AppError } from '../../lib/errors';
import { SYSTEM_LEAVE_CODES } from '../../models/enums';
import type { PeriodAttendanceImport, PeriodAttendanceSave } from '../../models/payroll/preparation.schema';
import type { Conn } from './finalisedPeriods';
import { confirmOverwrite, isEditable, lockForInput } from './periodLock';
import { employeesInService, salaryOnly, serviceSpan } from './payrollRunService';

interface Entry {
  headQuarters: number;
  camp: number;
  remarks: string | null;
  leaves: Map<number, number>;
}
const isBlank = (e: Entry) => e.headQuarters === 0 && e.camp === 0 && !e.remarks && [...e.leaves.values()].every((d) => d === 0);
const same = (a: Entry, b: Entry) =>
  a.headQuarters === b.headQuarters && a.camp === b.camp && (a.remarks ?? '') === (b.remarks ?? '') &&
  [...new Set([...a.leaves.keys(), ...b.leaves.keys()])].every((k) => (a.leaves.get(k) ?? 0) === (b.leaves.get(k) ?? 0));

/** In the order of the Leave Types screen: CL, EL, ML, LOP, then the rest by code. */
const rank = (code: string | null) => { const n = (SYSTEM_LEAVE_CODES as readonly string[]).indexOf(code ?? ''); return n < 0 ? 99 : n; };
async function leaveTypes(c: Conn) {
  const rows = await c
    .selectFrom('hr.employee_leave_types')
    .select(['id', 'leave_code', 'leave_name', 'pay_cut_factor', 'cuts_special_pay_and_da', 'is_active'])
    .orderBy('leave_code')
    .execute();
  return rows.sort((a, b) => rank(a.leave_code) - rank(b.leave_code));
}

async function saved(c: Conn, periodId: number) {
  const [rows, leaves] = await Promise.all([
    c.selectFrom('payroll.payroll_period_attendances').selectAll().where('payroll_period_id', '=', periodId).execute(),
    c
      .selectFrom('payroll.payroll_period_attendance_leaves as l')
      .innerJoin('payroll.payroll_period_attendances as a', 'a.id', 'l.payroll_period_attendance_id')
      .select(['a.employee_id', 'l.leave_type_id', 'l.days'])
      .where('a.payroll_period_id', '=', periodId)
      .execute(),
  ]);
  const out = new Map<number, Entry & { id: number }>();
  for (const r of rows) out.set(r.employee_id, { id: r.id, headQuarters: r.head_quarters, camp: r.camp, remarks: r.remarks, leaves: new Map() });
  for (const l of leaves) out.get(l.employee_id)!.leaves.set(l.leave_type_id, l.days);
  return out;
}

async function roster(c: Conn, p: { from_date: string; to_date: string }) {
  const period = { from: p.from_date, to: p.to_date };
  return (await employeesInService(c, period)).map((e) => {
    const s = serviceSpan(e, period);
    return { ...e, serviceDays: daysInclusive(s.from, s.to) };
  });
}

export async function get(periodId: number) {
  const p = await db.selectFrom('payroll.payroll_periods').selectAll().where('id', '=', periodId).executeTakeFirst();
  if (!p) throw AppError.notFound('Payroll period not found');
  salaryOnly(p, 'Monthly attendance is');
  const [employees, types, entries] = await Promise.all([roster(db, p), leaveTypes(db), saved(db, periodId)]);
  const used = new Set([...entries.values()].flatMap((e) => [...e.leaves.keys()]));
  return {
    periodId,
    editable: isEditable(p),
    totalDays: daysInclusive(p.from_date, p.to_date),
    // Inactive types stay visible where days are already saved.
    leaveTypes: types
      .filter((t) => t.is_active || used.has(t.id))
      .map((t) => ({ id: t.id, code: t.leave_code ?? t.leave_name, name: t.leave_name, payCutFactor: t.pay_cut_factor, cutsSpecialPayAndDa: t.cuts_special_pay_and_da })),
    rows: employees.map((e) => {
      const a = entries.get(e.id);
      return {
        employeeId: e.id, employeeCode: e.employee_code, employeeName: e.employee_name, branch: e.branch_name, serviceDays: e.serviceDays,
        saved: !!a, headQuarters: a?.headQuarters ?? 0, camp: a?.camp ?? 0, remarks: a?.remarks ?? '',
        leaves: Object.fromEntries(a?.leaves ?? []) as Record<number, number>,
      };
    }),
  };
}

function problem(e: Entry, serviceDays: number, totalDays: number): string | null {
  const leave = [...e.leaves.values()].reduce((n, d) => n + d, 0);
  if (leave > serviceDays) return `${leave} days of leave, but only ${serviceDays} days in service`;
  if (e.headQuarters > totalDays || e.camp > totalDays) return `HQ and Camp cannot be more than ${totalDays} days`;
  return null;
}

type Period = Awaited<ReturnType<typeof lockForInput>>;

async function write(trx: Tx, actor: Actor, p: Period, changes: Array<{ employeeId: number; branchId: number; entry: Entry; existingId: number | null }>) {
  let written = 0;
  let removed = 0;
  for (const { employeeId, branchId, entry, existingId } of changes) {
    if (isBlank(entry)) {
      if (existingId !== null) {
        await trx.deleteFrom('payroll.payroll_period_attendances').where('id', '=', existingId).execute();
        removed++;
      }
      continue;
    }
    const cols = {
      total_days_in_month: daysInclusive(p.from_date, p.to_date), total_working_days: p.working_days ?? 0,
      head_quarters: entry.headQuarters, camp: entry.camp, remarks: entry.remarks,
    };
    let id = existingId;
    if (id === null) {
      const row = await trx
        .insertInto('payroll.payroll_period_attendances')
        .values({ payroll_period_id: p.id, employee_id: employeeId, ...cols, branch_id: branchId, financial_year_id: p.financial_year_id, created_by: actorName(actor) })
        .returning('id')
        .executeTakeFirstOrThrow();
      id = row.id;
    } else {
      await trx.updateTable('payroll.payroll_period_attendances').set(cols).where('id', '=', id).execute();
      await trx.deleteFrom('payroll.payroll_period_attendance_leaves').where('payroll_period_attendance_id', '=', id).execute();
    }
    const leaves = [...entry.leaves].filter(([, days]) => days > 0);
    if (leaves.length)
      await trx.insertInto('payroll.payroll_period_attendance_leaves').values(leaves.map(([leave_type_id, days]) => ({ payroll_period_attendance_id: id!, leave_type_id, days }))).execute();
    written++;
  }
  return { saved: written, removed };
}

const overwriteMessage = (replaced: number, removed: number) =>
  `${[replaced && `${replaced} saved row(s) will be replaced`, removed && `${removed} saved row(s) will be deleted`].filter(Boolean).join(' and ')}.`;

export async function save(actor: Actor, periodId: number, i: PeriodAttendanceSave) {
  return withAudit(actor, async (trx) => {
    const p = await lockForInput(trx, periodId, 'Attendance');
    const [employees, types, existing] = await Promise.all([roster(trx, p), leaveTypes(trx), saved(trx, periodId)]);
    const byId = new Map(employees.map((e) => [e.id, e]));
    const typeIds = new Set(types.map((t) => t.id));
    const total = daysInclusive(p.from_date, p.to_date);
    const errors: Array<{ employeeId: number; message: string }> = [];
    const seen = new Set<number>();
    const changes: Parameters<typeof write>[3] = [];
    for (const r of i.entries) {
      const e = byId.get(r.employeeId);
      const fail = (message: string) => errors.push({ employeeId: r.employeeId, message: e ? `${e.employee_code}: ${message}` : message });
      if (!e) { fail('Employee is not in service in this period'); continue; }
      if (seen.has(e.id)) { fail('Entered twice'); continue; }
      seen.add(e.id);
      if (r.leaves.some((l) => !typeIds.has(l.leaveTypeId))) { fail('Unknown leave type'); continue; }
      const entry: Entry = { headQuarters: r.headQuarters, camp: r.camp, remarks: r.remarks ?? null, leaves: new Map(r.leaves.map((l) => [l.leaveTypeId, l.days])) };
      const msg = problem(entry, e.serviceDays, total);
      if (msg) { fail(msg); continue; }
      const old = existing.get(e.id);
      if (old ? same(old, entry) : isBlank(entry)) continue;
      changes.push({ employeeId: e.id, branchId: e.branch_id, entry, existingId: old?.id ?? null });
    }
    if (errors.length) throw new AppError(400, errors[0]!.message, 'ATTENDANCE_INVALID', { errors });
    const replaced = changes.filter((c) => c.existingId !== null && !isBlank(c.entry)).length;
    const removed = changes.filter((c) => c.existingId !== null && isBlank(c.entry)).length;
    if (replaced + removed > 0 && !i.confirm) throw confirmOverwrite({ replaced, removed }, overwriteMessage(replaced, removed));
    return write(trx, actor, p, changes);
  });
}

const FIXED_HEADERS = { hq: 'headQuarters', camp: 'camp' } as const;

/**
 * Upload. A column that is not in the sheet leaves those days unchanged; a blank cell counts as 0. Rows with
 * errors are reported and left out, and the valid rows are saved.
 */
export async function importRows(actor: Actor, periodId: number, i: PeriodAttendanceImport) {
  return withAudit(actor, async (trx) => {
    const p = await lockForInput(trx, periodId, 'Attendance');
    const [employees, types, existing] = await Promise.all([roster(trx, p), leaveTypes(trx), saved(trx, periodId)]);
    const byCode = new Map(employees.map((e) => [e.employee_code.toUpperCase(), e]));
    const typeByCode = new Map(types.filter((t) => t.is_active).map((t) => [(t.leave_code ?? t.leave_name).toUpperCase(), t.id]));
    const total = daysInclusive(p.from_date, p.to_date);

    const columns = i.headers.map((raw) => {
      const h = raw.trim();
      const fixed = FIXED_HEADERS[h.toLowerCase() as keyof typeof FIXED_HEADERS];
      if (fixed) return { header: h, fixed, leaveTypeId: null };
      const leaveTypeId = typeByCode.get(h.toUpperCase());
      if (leaveTypeId === undefined)
        throw AppError.badRequest(`Unknown column header '${h}'. Expected EmployeeCode, EmployeeName, HQ, Camp, or a leave code from Leave Types.`);
      return { header: h, fixed: null, leaveTypeId };
    });
    const names = columns.map((c) => c.header.toUpperCase());
    const twice = names.find((h, n) => names.indexOf(h) !== n);
    if (twice) throw AppError.badRequest(`Column '${twice}' appears twice.`);

    const firstLine = new Map<string, number>();
    const changes: Parameters<typeof write>[3] = [];
    const rows = i.rows.map((r) => {
      const code = r.code.trim();
      const e = byCode.get(code.toUpperCase());
      const out = (action: 'NEW' | 'OVERWRITE' | 'REMOVE' | 'UNCHANGED' | null, error: string | null = null) =>
        ({ line: r.line, code, name: e?.employee_name ?? '', action, error });
      if (!code) return out(null, `Row ${r.line}: employee code is blank.`);
      if (!e) return out(null, `Row ${r.line}: '${code}' is not an employee in service in this period; skipped.`);
      const dup = firstLine.get(code.toUpperCase());
      if (dup) return out(null, `Row ${r.line}: same employee as row ${dup}.`);
      firstLine.set(code.toUpperCase(), r.line);
      const old = existing.get(e.id);
      const entry: Entry = { headQuarters: old?.headQuarters ?? 0, camp: old?.camp ?? 0, remarks: old?.remarks ?? null, leaves: new Map(old?.leaves) };
      for (const [n, c] of columns.entries()) {
        const v = (r.values[n] ?? '').trim();
        if (!/^\d*(\.0+)?$/.test(v)) return out(null, `Row ${r.line}: column '${c.header}' is not a whole number.`);
        const days = v === '' ? 0 : Number(v);
        if (c.fixed) entry[c.fixed] = days;
        else entry.leaves.set(c.leaveTypeId!, days);
      }
      const msg = problem(entry, e.serviceDays, total);
      if (msg) return out(null, `Row ${r.line}: ${msg}.`);
      if (old ? same(old, entry) : isBlank(entry)) return out('UNCHANGED');
      changes.push({ employeeId: e.id, branchId: e.branch_id, entry, existingId: old?.id ?? null });
      return out(!old ? 'NEW' : isBlank(entry) ? 'REMOVE' : 'OVERWRITE');
    });
    const count = (a: string) => rows.filter((r) => r.action === a).length;
    const result = { total: rows.length, added: count('NEW'), overwritten: count('OVERWRITE'), removed: count('REMOVE'), unchanged: count('UNCHANGED'), errors: rows.filter((r) => r.error).length, rows, imported: 0 };
    if (i.dryRun) return result;
    if (result.overwritten + result.removed > 0 && !i.confirm)
      throw confirmOverwrite({ replaced: result.overwritten, removed: result.removed }, overwriteMessage(result.overwritten, result.removed));
    const done = await write(trx, actor, p, changes);
    return { ...result, imported: done.saved + done.removed };
  });
}
