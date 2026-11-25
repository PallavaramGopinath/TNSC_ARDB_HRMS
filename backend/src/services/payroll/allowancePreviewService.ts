/**
 * Allowance preview (specs/06): Basic Pay, DA, HRA, CCA and MA of every serving employee for a SALARY
 * period, with what is missing. Read-only — nothing is saved. The figures come from the same run as Payroll
 * Preparation (specs/08), without the leave entered for the month.
 */
import { db } from '../../config/db';
import { AppError } from '../../lib/errors';
import { D, prorate, toMoneyString, type Decimal } from '../../lib/money';
import type { AllowanceIssue } from './allowanceRules';
import { methodOn } from './hraCcaBasisService';
import { computeRun, salaryOnly } from './payrollRunService';

const money = (v: Decimal | null) => (v === null ? null : toMoneyString(v));
const SHOWN = new Set<string>(['BASIC_PAY', 'DA_RATE', 'HRA', 'CCA', 'MA', 'PART_MONTH']);

export async function preview(periodId: number) {
  const p = await db.selectFrom('payroll.payroll_periods').selectAll().where('id', '=', periodId).executeTakeFirst();
  if (!p) throw AppError.notFound('Payroll period not found');
  salaryOnly(p, 'Allowances can be previewed');
  const { from_date: from, to_date: to } = p;
  const [run, method] = await Promise.all([computeRun(db, p, { monthly: false }), methodOn(to, db)]);

  const rows = run.items.map(({ employee: e, rule, bill }) => {
    const { pay, allowances: r, calendarDays, serviceDays } = bill;
    // HRA and CCA are already for the days in service; DA and MA come back for the month.
    const served = (v: Decimal | null) => v && prorate(v, calendarDays - serviceDays, calendarDays);
    const da = served(r.da);
    const ma = served(r.ma);
    return {
      employeeId: e.id,
      employeeCode: e.employee_code,
      employeeName: e.employee_name,
      designation: rule.designation,
      branch: rule.branch,
      place: rule.place,
      basic: toMoneyString(pay.basic),
      pp: toMoneyString(pay.pp),
      gp: toMoneyString(pay.gp),
      basicPay: money(r.basicPay),
      da: money(da),
      hra: money(r.hra),
      cca: money(r.cca),
      ma: money(ma),
      total: da && r.hra && r.cca && ma ? toMoneyString(da.plus(r.hra).plus(r.cca).plus(ma)) : null,
      issues: bill.issues.filter((i): i is AllowanceIssue => SHOWN.has(i.code)),
      applied: r.applied,
    };
  });

  const withErrors = rows.filter((r) => r.issues.some((i) => i.severity === 'ERROR')).length;
  const da = run.daRate;
  return {
    period: { id: p.id, month: p.month, calendarYear: p.calendar_year, fromDate: from, toDate: to, status: p.payroll_status },
    method,
    daRate: da ? { id: da.id, percentage: da.percentage, effectiveFrom: da.effective_from } : null,
    medicalAmount: run.medicalAmount === null ? null : toMoneyString(D(run.medicalAmount)),
    employeeCount: rows.length,
    employeesWithErrors: withErrors,
    /** False while any employee has an ERROR: payroll must not be finalised. */
    ready: withErrors === 0,
    employees: rows,
  };
}
