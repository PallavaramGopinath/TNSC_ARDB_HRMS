/**
 * Allowance preview (specs/06): Basic Pay, DA, HRA, CCA and MA of every serving employee for a SALARY
 * period, with what is missing. Read-only — nothing is saved. Payroll Preparation will use the same rules
 * (allowanceRules.ts) and must refuse to finalise while there are ERROR issues.
 */
import { sql } from 'kysely';
import { db } from '../../config/db';
import { AppError } from '../../lib/errors';
import { D, toMoneyString, type Decimal } from '../../lib/money';
import { getSetting } from '../../lib/settings';
import { ComponentCode } from '../../models/enums';
import { computeAllowances, MEDICAL_ALLOWANCE_KEY, type AllowanceIssue } from './allowanceRules';
import { daRates } from './daRateService';
import { methodOn } from './hraCcaBasisService';
import { resolveMany } from './hraCcaRateResolver';
import { payrollPrintOrder } from './printOrder';

const money = (v: Decimal | null) => (v === null ? null : toMoneyString(v));

/** FIXED BASIC, PP and GP assignments in force on a date: employee → component code → amount. */
async function payOn(date: string) {
  const rows = await db
    .selectFrom('payroll.payroll_component_assignments as a')
    .innerJoin('payroll.payroll_components as c', 'c.id', 'a.component_id')
    .select((eb) => ['a.employee_id', 'a.assigned_amount', eb.fn<string>('upper', ['c.component_code']).as('code')])
    .where((eb) => eb(eb.fn<string>('upper', ['c.component_code']), 'in', [ComponentCode.Basic, ComponentCode.PersonalPay, ComponentCode.GradePay]))
    .where('a.assigned_type', '=', 'FIXED')
    .where('a.is_active', '=', true)
    .where((eb) => eb.or([eb('a.effective_from', 'is', null), eb('a.effective_from', '<=', date)]))
    .where((eb) => eb.or([eb('a.effective_to', 'is', null), eb('a.effective_to', '>=', date)]))
    .orderBy(sql`a.effective_from asc nulls first`) // the latest wins below
    .orderBy('a.id')
    .execute();
  const out = new Map<number, Record<string, string>>();
  for (const r of rows) out.set(r.employee_id, { ...out.get(r.employee_id), [r.code]: r.assigned_amount });
  return out;
}

export async function preview(periodId: number) {
  const p = await db.selectFrom('payroll.payroll_periods').selectAll().where('id', '=', periodId).executeTakeFirst();
  if (!p) throw AppError.notFound('Payroll period not found');
  if (p.payroll_type !== 'SALARY') throw AppError.badRequest('Allowances can be previewed for SALARY periods only');
  const { from_date: from, to_date: to } = p;

  const employees = await db
    .selectFrom('hr.employees as e')
    .innerJoin('hr.employee_designations as d', 'd.id', 'e.designation_id')
    .select(['e.id', 'e.employee_code', 'e.employee_name', 'e.branch_id', 'e.designation_id', 'e.basic_salary', 'e.date_of_joining', 'e.date_of_leaving'])
    .where((eb) => eb.or([eb('e.date_of_joining', 'is', null), eb('e.date_of_joining', '<=', to)]))
    .where((eb) => eb.or([eb('e.date_of_leaving', 'is', null), eb('e.date_of_leaving', '>=', from)]))
    .orderBy(payrollPrintOrder)
    .execute();
  const [method, da, medical, pay, rules] = await Promise.all([
    methodOn(to),
    daRates.rateOn(to),
    getSetting<number | string | null>(MEDICAL_ALLOWANCE_KEY, null, to),
    payOn(to),
    resolveMany(employees, from, to),
  ]);

  const rows = employees.map((e) => {
    const assigned = pay.get(e.id) ?? {};
    const parts = {
      basic: assigned[ComponentCode.Basic] ?? e.basic_salary,
      pp: assigned[ComponentCode.PersonalPay] ?? '0',
      gp: assigned[ComponentCode.GradePay] ?? '0',
    };
    const rule = rules.get(e.id)!;
    const r = computeAllowances({
      pay: parts,
      daRate: da ? { id: da.id, percentage: da.percentage } : null,
      medicalAmount: medical,
      hra: rule.hra,
      cca: rule.cca,
      totalDays: rule.totalDays,
      asOn: to,
    });
    const issues: AllowanceIssue[] = [...r.issues];
    const part = (message: string) => issues.push({ code: 'PART_MONTH', severity: 'WARNING', message });
    if (e.date_of_joining && e.date_of_joining > from) part(`Joined on ${e.date_of_joining}; full-month amounts are shown`);
    if (e.date_of_leaving && e.date_of_leaving < to) part(`Leaves on ${e.date_of_leaving}; full-month amounts are shown`);
    return {
      employeeId: e.id,
      employeeCode: e.employee_code,
      employeeName: e.employee_name,
      designation: rule.designation,
      branch: rule.branch,
      place: rule.place,
      basic: toMoneyString(D(parts.basic)),
      pp: toMoneyString(D(parts.pp)),
      gp: toMoneyString(D(parts.gp)),
      basicPay: money(r.basicPay),
      da: money(r.da),
      hra: money(r.hra),
      cca: money(r.cca),
      ma: money(r.ma),
      total: money(r.total),
      issues,
      applied: r.applied,
    };
  });

  const withErrors = rows.filter((r) => r.issues.some((i) => i.severity === 'ERROR')).length;
  return {
    period: { id: p.id, month: p.month, calendarYear: p.calendar_year, fromDate: from, toDate: to, status: p.payroll_status },
    method,
    daRate: da ? { id: da.id, percentage: da.percentage, effectiveFrom: da.effective_from } : null,
    medicalAmount: medical === null ? null : toMoneyString(D(medical)),
    employeeCount: rows.length,
    employeesWithErrors: withErrors,
    /** False while any employee has an ERROR: payroll must not be finalised. */
    ready: withErrors === 0,
    employees: rows,
  };
}
