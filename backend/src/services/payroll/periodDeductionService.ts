/**
 * Agency deductions of a SALARY period (specs/08 §5.2): the month's amount of a fixed deduction, in place of the
 * assigned one. No entry = the assigned amount applies. An entry of 0 waives the deduction for the month.
 */
import { db } from '../../config/db';
import { businessDate } from '../../lib/dates';
import { actorName, withAudit, type Actor, type Tx } from '../../lib/dbContext';
import { AppError } from '../../lib/errors';
import { D, toMoneyString } from '../../lib/money';
import type { PeriodDeductionImport, PeriodDeductionSave } from '../../models/payroll/preparation.schema';
import type { Conn } from './finalisedPeriods';
import { confirmOverwrite, isEditable, lockForInput } from './periodLock';
import { assignmentOn, isAgencyDeduction, normaliseCode, type PayComponent } from './payrollRules';
import { assignmentsInPeriod, employeesInService, salaryOnly, serviceSpan } from './payrollRunService';

export interface EligibleRow {
  employeeId: number;
  employeeCode: string;
  employeeName: string;
  branch: string;
  component: PayComponent;
  assigned: string;
}

/** Every employee × agency deduction assigned on the employee's last day of service in the period. */
export async function eligible(c: Conn, p: { from_date: string; to_date: string }): Promise<EligibleRow[]> {
  const period = { from: p.from_date, to: p.to_date };
  const [employees, assignments] = await Promise.all([employeesInService(c, period), assignmentsInPeriod(c, period)]);
  return employees.flatMap((e) => {
    const list = assignments.get(e.id) ?? [];
    const { to } = serviceSpan(e, period);
    return [...new Set(list.map((a) => a.component.id))].flatMap((componentId) => {
      const a = assignmentOn(list.filter((x) => x.component.id === componentId), to);
      if (!a || !isAgencyDeduction(a)) return [];
      return [{ employeeId: e.id, employeeCode: e.employee_code, employeeName: e.employee_name, branch: e.branch_name, component: a.component, assigned: toMoneyString(D(a.amount)) }];
    });
  });
}

const key = (employeeId: number, componentId: number) => `${employeeId}|${componentId}`;

export async function savedAmounts(c: Conn, periodId: number) {
  const rows = await c.selectFrom('payroll.payroll_period_deductions').selectAll().where('payroll_period_id', '=', periodId).execute();
  return new Map(rows.map((r) => [key(r.employee_id, r.component_id), r]));
}

/** Amounts of the SALARY month before this one, to start the template from. */
async function previousAmounts(c: Conn, p: { from_date: string }) {
  const before = await c
    .selectFrom('payroll.payroll_periods')
    .select('id')
    .where('payroll_type', '=', 'SALARY')
    .where('to_date', '<', p.from_date)
    .orderBy('to_date', 'desc')
    .executeTakeFirst();
  return before ? savedAmounts(c, before.id) : new Map<string, { amount: string }>();
}

export async function get(periodId: number) {
  const p = await db.selectFrom('payroll.payroll_periods').selectAll().where('id', '=', periodId).executeTakeFirst();
  if (!p) throw AppError.notFound('Payroll period not found');
  salaryOnly(p, 'Agency deductions are');
  const [rows, saved, previous] = await Promise.all([eligible(db, p), savedAmounts(db, periodId), previousAmounts(db, p)]);
  const components = new Map(rows.map((r) => [r.component.id, { id: r.component.id, code: r.component.code, name: r.component.name }]));
  return {
    periodId,
    editable: isEditable(p),
    period: { month: p.month, calendarYear: p.calendar_year },
    asOn: businessDate(),
    components: [...components.values()].sort((a, b) => a.code.localeCompare(b.code)),
    rows: rows.map((r) => {
      const s = saved.get(key(r.employeeId, r.component.id));
      return {
        employeeId: r.employeeId, employeeCode: r.employeeCode, employeeName: r.employeeName, branch: r.branch,
        componentId: r.component.id, componentCode: r.component.code, componentName: r.component.name,
        assigned: r.assigned, amount: s?.amount ?? null, remarks: s?.remarks ?? '', previous: previous.get(key(r.employeeId, r.component.id))?.amount ?? null,
      };
    }),
  };
}

interface Change {
  employeeId: number;
  componentId: number;
  /** null = remove the entry, so that the assigned amount applies again. */
  amount: string | null;
  remarks: string | null;
  existing: boolean;
}

async function write(trx: Tx, actor: Actor, periodId: number, changes: Change[]) {
  for (const c of changes) {
    if (c.amount === null) {
      await trx
        .deleteFrom('payroll.payroll_period_deductions')
        .where('payroll_period_id', '=', periodId)
        .where('employee_id', '=', c.employeeId)
        .where('component_id', '=', c.componentId)
        .execute();
      continue;
    }
    await trx
      .insertInto('payroll.payroll_period_deductions')
      .values({ payroll_period_id: periodId, employee_id: c.employeeId, component_id: c.componentId, amount: c.amount, remarks: c.remarks, created_by: actorName(actor) })
      .onConflict((oc) => oc.columns(['payroll_period_id', 'employee_id', 'component_id']).doUpdateSet({ amount: c.amount!, remarks: c.remarks }))
      .execute();
  }
  return { saved: changes.filter((c) => c.amount !== null).length, removed: changes.filter((c) => c.amount === null).length };
}

function requireConfirm(changes: Change[], confirm: boolean) {
  const replaced = changes.filter((c) => c.existing && c.amount !== null).length;
  const removed = changes.filter((c) => c.existing && c.amount === null).length;
  if (replaced + removed > 0 && !confirm)
    throw confirmOverwrite({ replaced, removed }, `${[replaced && `${replaced} saved amount(s) will be replaced`, removed && `${removed} saved amount(s) will be removed`].filter(Boolean).join(' and ')}.`);
}

export async function save(actor: Actor, periodId: number, i: PeriodDeductionSave) {
  return withAudit(actor, async (trx) => {
    const p = await lockForInput(trx, periodId, 'Agency deductions');
    const [rows, saved] = await Promise.all([eligible(trx, p), savedAmounts(trx, periodId)]);
    const allowed = new Map(rows.map((r) => [key(r.employeeId, r.component.id), r]));
    const seen = new Set<string>();
    const changes: Change[] = [];
    for (const e of i.entries) {
      const k = key(e.employeeId, e.componentId);
      if (seen.has(k)) throw AppError.badRequest('The same deduction is entered twice for an employee');
      seen.add(k);
      const old = saved.get(k);
      const remarks = e.remarks ?? null;
      const row = allowed.get(k);
      // An entry left over from an assignment that has ended can still be removed.
      if (!row && !(old && e.amount === null)) throw AppError.badRequest('An employee is not assigned this deduction in the period; refresh and try again');
      if (e.amount === null && remarks && row) throw AppError.badRequest(`${row.employeeCode} ${row.component.code}: enter an amount with the remarks`);
      const amount = e.amount === null ? null : toMoneyString(D(e.amount));
      if (old ? amount !== null && D(old.amount).eq(amount) && (old.remarks ?? '') === (remarks ?? '') : amount === null) continue;
      changes.push({ employeeId: e.employeeId, componentId: e.componentId, amount, remarks, existing: !!old });
    }
    requireConfirm(changes, i.confirm);
    return write(trx, actor, periodId, changes);
  });
}

export async function importRows(actor: Actor, periodId: number, i: PeriodDeductionImport) {
  return withAudit(actor, async (trx) => {
    const p = await lockForInput(trx, periodId, 'Agency deductions');
    const [rows, saved] = await Promise.all([eligible(trx, p), savedAmounts(trx, periodId)]);
    const mine = rows.filter((r) => r.component.id === i.componentId);
    if (mine.length === 0) throw AppError.badRequest('Selected component has no eligible employees for this period (needs an active FIXED deduction assignment).');
    const component = mine[0]!.component;
    if (i.sheetCode && normaliseCode(i.sheetCode) !== component.code)
      throw AppError.badRequest(`This sheet is for deduction '${i.sheetCode.trim()}', but '${component.code}' is selected. Pick the matching component or download a fresh template.`);
    const byCode = new Map(mine.map((r) => [r.employeeCode.toUpperCase(), r]));

    const firstLine = new Map<string, number>();
    const changes: Change[] = [];
    const results = i.rows.map((r) => {
      const code = r.code.trim();
      const e = byCode.get(code.toUpperCase());
      const old = e && saved.get(key(e.employeeId, i.componentId));
      const out = (action: 'NEW' | 'OVERWRITE' | 'REMOVE' | 'UNCHANGED' | null, amount: string | null, error: string | null = null) =>
        ({ line: r.line, code, name: e?.employeeName ?? '', previous: old?.amount ?? null, amount, assigned: e?.assigned ?? null, waived: amount !== null && D(amount).isZero(), action, error });
      if (!code) return out(null, null, `Row ${r.line}: employee code is blank.`);
      if (!e) return out(null, null, `Row ${r.line}: '${code}' is not assigned this deduction; skipped.`);
      const dup = firstLine.get(code.toUpperCase());
      if (dup) return out(null, null, `Row ${r.line}: same employee as row ${dup}.`);
      firstLine.set(code.toUpperCase(), r.line);
      const raw = r.amount.replace(/[,\s₹]/g, '');
      if (raw !== '' && !/^\d+(\.\d{1,2})?$/.test(raw)) return out(null, null, `Row ${r.line}: amount '${r.amount.trim()}' is not a number.`);
      const amount = raw === '' ? null : toMoneyString(D(raw));
      if (amount !== null && D(amount).gt(99_999_999.99)) return out(null, null, `Row ${r.line}: amount '${r.amount.trim()}' is too large.`);
      if (old ? amount !== null && D(old.amount).eq(amount) : amount === null) return out('UNCHANGED', amount);
      changes.push({ employeeId: e.employeeId, componentId: i.componentId, amount, remarks: old?.remarks ?? null, existing: !!old });
      return out(!old ? 'NEW' : amount === null ? 'REMOVE' : 'OVERWRITE', amount);
    });
    const count = (a: string) => results.filter((r) => r.action === a).length;
    const result = { total: results.length, added: count('NEW'), overwritten: count('OVERWRITE'), removed: count('REMOVE'), unchanged: count('UNCHANGED'), errors: results.filter((r) => r.error).length, rows: results, imported: 0 };
    if (i.dryRun) return result;
    requireConfirm(changes, i.confirm);
    const done = await write(trx, actor, periodId, changes);
    return { ...result, imported: done.saved + done.removed };
  });
}
