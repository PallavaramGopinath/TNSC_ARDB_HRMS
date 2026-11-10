/**
 * Daily attendance (hr.employee_attendances) — monthly grid per branch and the TNCU CSV import
 * (`code,date,status`). Rules live in attendanceRules.ts. All writes go through withAudit.
 */
import { sql } from 'kysely';
import { db } from '../../config/db';
import { businessDate, monthBounds } from '../../lib/dates';
import { actorName, withAudit, type Actor, type Tx } from '../../lib/dbContext';
import { AppError } from '../../lib/errors';
import {
  parseImportStatus,
  type AttendanceImportInput,
  type AttendanceMonthQuery,
  type AttendanceSaveInput,
  type AttendanceStatusValue,
} from '../../models/hr/attendance.schema';
import { checkEntry, lockFor, parseFlexibleDate, type LockedRange } from './attendanceRules';

const CHUNK = 500;

/** APPROVED / LOCKED salary periods of these branches that overlap [from, to], keyed by branch. */
async function lockedRanges(q: Tx | typeof db, branchIds: number[], from: string, to: string) {
  const out = new Map<number, LockedRange[]>();
  if (branchIds.length === 0) return out;
  const rows = await q
    .selectFrom('payroll.payroll_periods')
    .select(['branch_id', 'from_date', 'to_date', 'payroll_status'])
    .where('branch_id', 'in', branchIds)
    .where('payroll_type', '=', 'SALARY')
    .where('is_active', '=', true)
    .where('payroll_status', 'in', ['APPROVED', 'LOCKED'])
    .where('from_date', '<=', to)
    .where('to_date', '>=', from)
    .execute();
  for (const r of rows) {
    const list = out.get(r.branch_id) ?? [];
    list.push({ from: r.from_date, to: r.to_date, status: r.payroll_status });
    out.set(r.branch_id, list);
  }
  return out;
}

/** Financial year id for each date, from core.financial_years. */
async function fyResolver(trx: Tx, from: string, to: string) {
  const fys = await trx
    .selectFrom('core.financial_years')
    .select(['id', 'start_date', 'end_date'])
    .where('start_date', '<=', to)
    .where('end_date', '>=', from)
    .execute();
  return (date: string) => fys.find((f) => date >= f.start_date && date <= f.end_date)?.id ?? null;
}

interface UpsertRow {
  employeeId: number;
  date: string;
  status: AttendanceStatusValue;
  remarks: string | null;
  branchId: number;
}

async function upsert(trx: Tx, actor: Actor, rows: UpsertRow[]) {
  if (rows.length === 0) return;
  const dates = rows.map((r) => r.date).sort();
  const fyOf = await fyResolver(trx, dates[0]!, dates[dates.length - 1]!);
  const by = actorName(actor);
  for (let i = 0; i < rows.length; i += CHUNK) {
    await trx
      .insertInto('hr.employee_attendances')
      .values(
        rows.slice(i, i + CHUNK).map((r) => ({
          employee_id: r.employeeId,
          attendance_date: r.date,
          attendance_status: r.status,
          remarks: r.remarks,
          branch_id: r.branchId,
          financial_year_id: fyOf(r.date),
          created_by: by,
        })),
      )
      .onConflict((oc) =>
        oc.columns(['employee_id', 'attendance_date']).doUpdateSet((eb) => ({
          attendance_status: eb.ref('excluded.attendance_status'),
          remarks: eb.ref('excluded.remarks'),
          branch_id: eb.ref('excluded.branch_id'),
          financial_year_id: eb.ref('excluded.financial_year_id'),
        })),
      )
      .execute();
  }
}

/** The grid for one branch and month: days, employees who served there, and their marks. */
export async function getMonth(q: AttendanceMonthQuery) {
  const branch = await db.selectFrom('core.branches').select(['id', 'code', 'name']).where('id', '=', q.branchId).executeTakeFirst();
  if (!branch) throw AppError.notFound('Branch not found');
  const { from, to } = monthBounds(q.year, q.month);

  const employees = await db
    .selectFrom('hr.employees as e')
    .innerJoin('hr.employee_designations as d', 'd.id', 'e.designation_id')
    .select(['e.id', 'e.employee_code', 'e.employee_name', 'd.designation_name', 'e.date_of_joining', 'e.date_of_leaving', 'e.branch_id'])
    .where((eb) =>
      eb.or([
        eb.and([
          eb('e.branch_id', '=', q.branchId),
          eb.or([eb('e.date_of_joining', 'is', null), eb('e.date_of_joining', '<=', to)]),
          eb.or([eb('e.date_of_leaving', 'is', null), eb('e.date_of_leaving', '>=', from)]),
        ]),
        eb(
          'e.id',
          'in',
          eb
            .selectFrom('hr.employee_attendances as a')
            .select('a.employee_id')
            .where('a.branch_id', '=', q.branchId)
            .where('a.attendance_date', '>=', from)
            .where('a.attendance_date', '<=', to),
        ),
      ]),
    )
    .orderBy('e.employee_code')
    .execute();

  const ids = employees.map((e) => e.id);
  const marks = ids.length
    ? await db
        .selectFrom('hr.employee_attendances')
        .select(['employee_id', 'attendance_date', 'attendance_status', 'remarks', 'branch_id'])
        .where('employee_id', 'in', ids)
        .where('attendance_date', '>=', from)
        .where('attendance_date', '<=', to)
        .execute()
    : [];
  const records: Record<number, Record<string, { status: string; remarks: string | null; branchId: number }>> = {};
  for (const m of marks) (records[m.employee_id] ??= {})[m.attendance_date] = { status: m.attendance_status, remarks: m.remarks, branchId: m.branch_id };

  const locks = (await lockedRanges(db, [q.branchId], from, to)).get(q.branchId) ?? [];
  const last = Number(to.slice(8));
  const days = Array.from({ length: last }, (_, i) => {
    const date = `${from.slice(0, 8)}${String(i + 1).padStart(2, '0')}`;
    const lock = lockFor(date, locks);
    return { date, day: i + 1, weekday: new Date(`${date}T00:00:00Z`).getUTCDay(), locked: !!lock };
  });
  const lock = locks[0];

  return {
    branch,
    year: q.year,
    month: q.month,
    today: businessDate(),
    days,
    lockedReason: lock ? `Salary payroll for this month is ${lock.status.toLowerCase()}` : null,
    employees,
    records,
  };
}

/** Save grid edits for one branch: upsert marked days, delete cleared ones. All or nothing. */
export async function save(actor: Actor, input: AttendanceSaveInput) {
  const seen = new Set<string>();
  for (const e of input.entries) {
    const k = `${e.employeeId}|${e.date}`;
    if (seen.has(k)) throw AppError.badRequest(`Duplicate entry for employee ${e.employeeId} on ${e.date}`);
    seen.add(k);
  }

  return withAudit(actor, async (trx) => {
    const ids = [...new Set(input.entries.map((e) => e.employeeId))];
    const emps = await trx.selectFrom('hr.employees').select(['id', 'employee_code', 'date_of_joining', 'date_of_leaving']).where('id', 'in', ids).execute();
    const byId = new Map(emps.map((e) => [e.id, e]));
    const dates = input.entries.map((e) => e.date).sort();
    const locks = (await lockedRanges(trx, [input.branchId], dates[0]!, dates[dates.length - 1]!)).get(input.branchId) ?? [];
    const today = businessDate();

    const errors: Array<{ employeeId: number; date: string; message: string }> = [];
    for (const e of input.entries) {
      const emp = byId.get(e.employeeId);
      const msg = emp ? checkEntry(emp, e.date, e.status, today, locks) : 'Employee not found';
      if (msg) errors.push({ employeeId: e.employeeId, date: e.date, message: emp ? `${emp.employee_code} on ${e.date}: ${msg}` : msg });
    }
    if (errors.length)
      throw new AppError(400, errors.length === 1 ? errors[0]!.message : `${errors.length} days could not be saved — ${errors[0]!.message}`, 'ATTENDANCE_INVALID', { errors });

    const toSave = input.entries.filter((e) => e.status !== null);
    const toClear = input.entries.filter((e) => e.status === null);
    await upsert(
      trx,
      actor,
      toSave.map((e) => ({ employeeId: e.employeeId, date: e.date, status: e.status!, remarks: e.remarks ?? null, branchId: input.branchId })),
    );
    for (let i = 0; i < toClear.length; i += CHUNK) {
      const part = toClear.slice(i, i + CHUNK);
      await trx
        .deleteFrom('hr.employee_attendances')
        .where((eb) => eb.or(part.map((e) => eb.and([eb('employee_id', '=', e.employeeId), eb('attendance_date', '=', e.date)]))))
        .execute();
    }
    return { saved: toSave.length, cleared: toClear.length };
  });
}

/**
 * CSV import (TNCU columns code,date,status; the month sheet is flattened to these rows in the
 * browser). Marks equal to what is already saved are skipped as `unchanged` — so a re-uploaded,
 * pre-filled sheet does not trip over locked months. Every other row is checked; with
 * dryRun=false and no errors, they are upserted in one transaction against each employee's
 * current branch.
 */
export async function importRows(actor: Actor, input: AttendanceImportInput) {
  const codes = [...new Set(input.rows.map((r) => r.code.toUpperCase()).filter(Boolean))];
  const emps = codes.length
    ? await db
        .selectFrom('hr.employees')
        .select(['id', 'employee_code', 'branch_id', 'date_of_joining', 'date_of_leaving'])
        .where(sql<string>`upper(employee_code)`, 'in', codes)
        .execute()
    : [];
  const byCode = new Map(emps.map((e) => [e.employee_code.toUpperCase(), e]));

  const parsed = input.rows.map((r) => ({ ...r, iso: parseFlexibleDate(r.date), st: parseImportStatus(r.status), emp: byCode.get(r.code.toUpperCase()) }));
  const isoDates = parsed.map((p) => p.iso).filter((d): d is string => !!d).sort();
  const locks = isoDates.length ? await lockedRanges(db, [...new Set(emps.map((e) => e.branch_id))], isoDates[0]!, isoDates[isoDates.length - 1]!) : new Map<number, LockedRange[]>();
  const today = businessDate();
  const empIds = [...new Set(parsed.flatMap((p) => (p.emp ? [p.emp.id] : [])))];
  const existing = new Map<string, string>();
  if (empIds.length && isoDates.length) {
    const marks = await db
      .selectFrom('hr.employee_attendances')
      .select(['employee_id', 'attendance_date', 'attendance_status'])
      .where('employee_id', 'in', empIds)
      .where('attendance_date', '>=', isoDates[0]!)
      .where('attendance_date', '<=', isoDates[isoDates.length - 1]!)
      .execute();
    for (const m of marks) existing.set(`${m.employee_id}|${m.attendance_date}`, m.attendance_status);
  }

  const errors: Array<{ line: number; code: string; date: string; message: string }> = [];
  let unchanged = 0;
  const seen = new Map<string, number>();
  const valid: UpsertRow[] = [];
  for (const p of parsed) {
    const fail = (message: string) => errors.push({ line: p.line, code: p.code, date: p.date, message });
    if (!p.code) { fail('Employee code is missing'); continue; }
    if (!p.emp) { fail(`No employee with code ${p.code}`); continue; }
    if (!p.iso) { fail(`Date "${p.date}" is not valid (use YYYY-MM-DD or DD-MM-YYYY)`); continue; }
    if (!p.st) { fail(`Status "${p.status}" is not valid (use P, A, L, H or HD)`); continue; }
    const key = `${p.emp.id}|${p.iso}`;
    const dup = seen.get(key);
    if (dup) { fail(`Same employee and date as row ${dup}`); continue; }
    seen.set(key, p.line);
    if (existing.get(key) === p.st) { unchanged++; continue; }
    const msg = checkEntry(p.emp, p.iso, p.st, today, locks.get(p.emp.branch_id) ?? []);
    if (msg) { fail(msg); continue; }
    valid.push({ employeeId: p.emp.id, date: p.iso, status: p.st, remarks: null, branchId: p.emp.branch_id });
  }

  const result = { total: input.rows.length, valid: valid.length, unchanged, errors, imported: 0 };
  if (input.dryRun || errors.length) return result;
  await withAudit(actor, (trx) => upsert(trx, actor, valid));
  return { ...result, imported: valid.length };
}
