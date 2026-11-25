/**
 * Loads everything a SALARY run needs and works out every employee's bill with payrollRules.ts. Reads only,
 * with a fixed number of queries whatever the headcount. Used by Prepare, by Approve (to see whether anything
 * changed since Prepare) and by the Allowance Preview, so that all three give the same figures.
 */
import { sql } from 'kysely';
import { AppError } from '../../lib/errors';
import { readSetting } from '../../lib/settings';
import { MEDICAL_ALLOWANCE_KEY } from './allowanceRules';
import { daRates } from './daRateService';
import type { Conn } from './finalisedPeriods';
import { resolveMany } from './hraCcaRateResolver';
import { computeBill, normaliseCode, type BillInput, type PayAssignment, type PayComponent, type Span } from './payrollRules';
import { pfRates } from './pfRateService';
import { payrollPrintOrder } from './printOrder';

export interface RunPeriod {
  id: number;
  payroll_type: string;
  from_date: string;
  to_date: string;
}

export const MIN_NET_KEY = 'payroll.min_net_percent_of_gross';

export const salaryOnly = (p: { payroll_type: string }, what: string) => {
  if (p.payroll_type !== 'SALARY') throw AppError.badRequest(`${what} for SALARY periods only`);
};

/** Everyone in service on any day of the period, in print order. */
export function employeesInService(c: Conn, span: Span) {
  return c
    .selectFrom('hr.employees as e')
    .innerJoin('hr.employee_designations as d', 'd.id', 'e.designation_id')
    .innerJoin('core.branches as b', 'b.id', 'e.branch_id')
    .select(['e.id', 'e.employee_code', 'e.employee_name', 'e.branch_id', 'b.name as branch_name', 'e.designation_id', 'd.designation_name', 'e.basic_salary', 'e.date_of_joining', 'e.date_of_leaving'])
    .where((eb) => eb.or([eb('e.date_of_joining', 'is', null), eb('e.date_of_joining', '<=', span.to)]))
    .where((eb) => eb.or([eb('e.date_of_leaving', 'is', null), eb('e.date_of_leaving', '>=', span.from)]))
    .orderBy(payrollPrintOrder)
    .execute();
}

/** The days of the period an employee is in service. */
export const serviceSpan = (e: { date_of_joining: string | null; date_of_leaving: string | null }, p: Span): Span => ({
  from: e.date_of_joining && e.date_of_joining > p.from ? e.date_of_joining : p.from,
  to: e.date_of_leaving && e.date_of_leaving < p.to ? e.date_of_leaving : p.to,
});

/** Active assignments in force on any day of the period, by employee. */
export async function assignmentsInPeriod(c: Conn, p: Span): Promise<Map<number, PayAssignment[]>> {
  const rows = await c
    .selectFrom('payroll.payroll_component_assignments as a')
    .innerJoin('payroll.payroll_components as c', 'c.id', 'a.component_id')
    .select([
      'a.id', 'a.employee_id', 'a.assigned_type', 'a.assigned_amount', 'a.percentage', 'a.minimum_amount', 'a.maximum_amount', 'a.effective_from', 'a.effective_to',
      'c.id as component_id', 'c.component_code', 'c.component_name', 'c.component_type', 'c.is_active as component_active',
    ])
    .where('a.is_active', '=', true)
    .where((eb) => eb.or([eb('a.effective_from', 'is', null), eb('a.effective_from', '<=', p.to)]))
    .where((eb) => eb.or([eb('a.effective_to', 'is', null), eb('a.effective_to', '>=', p.from)]))
    .orderBy(sql`c.display_order asc nulls last`)
    .orderBy('c.component_code')
    .orderBy('a.id')
    .execute();
  const out = new Map<number, PayAssignment[]>();
  for (const r of rows) {
    const a: PayAssignment = {
      id: r.id,
      component: { id: r.component_id, code: normaliseCode(r.component_code), name: r.component_name, type: r.component_type, isActive: r.component_active },
      assignedType: r.assigned_type,
      amount: r.assigned_amount,
      percentage: r.percentage,
      minAmount: r.minimum_amount,
      maxAmount: r.maximum_amount,
      from: r.effective_from,
      to: r.effective_to,
    };
    const list = out.get(r.employee_id);
    if (list) list.push(a);
    else out.set(r.employee_id, [a]);
  }
  return out;
}

async function leaveByEmployee(c: Conn, periodId: number) {
  const rows = await c
    .selectFrom('payroll.payroll_period_attendances as a')
    .innerJoin('payroll.payroll_period_attendance_leaves as l', 'l.payroll_period_attendance_id', 'a.id')
    .innerJoin('hr.employee_leave_types as t', 't.id', 'l.leave_type_id')
    .select(['a.employee_id', 'l.days', 't.pay_cut_factor', 't.cuts_special_pay_and_da'])
    .where('a.payroll_period_id', '=', periodId)
    .execute();
  const out = new Map<number, BillInput['leave']>();
  for (const r of rows) out.set(r.employee_id, [...(out.get(r.employee_id) ?? []), { days: r.days, factor: r.pay_cut_factor, cutsSpDa: r.cuts_special_pay_and_da }]);
  return out;
}

function amounts(rows: Array<{ employee_id: number; component_id: number; amount: string }>) {
  const out = new Map<number, Map<number, string>>();
  for (const r of rows) {
    if (!out.has(r.employee_id)) out.set(r.employee_id, new Map());
    out.get(r.employee_id)!.set(r.component_id, r.amount);
  }
  return out;
}

/** `monthly: false` leaves out what is entered for the month (leave, uploads, edits): the preview's full picture. */
export async function computeRun(c: Conn, p: RunPeriod, opts: { monthly: boolean } = { monthly: true }) {
  const period: Span = { from: p.from_date, to: p.to_date };
  const employees = (await employeesInService(c, period)).map((e) => ({ ...e, span: serviceSpan(e, period) }));
  const [rules, da, pf, medical, minNet, ceiling, samePf, componentRows, assignments, leave, uploads, overrides] = await Promise.all([
    resolveMany(employees, period.from, period.to, c),
    daRates.rateOn(period.to, c),
    pfRates.rateOn(period.to, c),
    readSetting<number | string | null>(c, MEDICAL_ALLOWANCE_KEY, null, period.to),
    readSetting<number | string>(c, MIN_NET_KEY, 25, period.to),
    readSetting<number | string>(c, 'payroll.pf_wage_ceiling', 0, period.to),
    readSetting<boolean>(c, 'payroll.employer_pf_equals_employee', true, period.to),
    c.selectFrom('payroll.payroll_components').select(['id', 'component_code', 'component_name', 'component_type', 'is_active']).execute(),
    assignmentsInPeriod(c, period),
    opts.monthly ? leaveByEmployee(c, p.id) : new Map<number, BillInput['leave']>(),
    opts.monthly
      ? c.selectFrom('payroll.payroll_period_deductions').select(['employee_id', 'component_id', 'amount']).where('payroll_period_id', '=', p.id).execute()
      : [],
    opts.monthly
      ? c.selectFrom('payroll.payroll_manual_deduction_overrides').select(['employee_id', 'component_id', 'override_amount as amount']).where('payroll_period_id', '=', p.id).execute()
      : [],
  ]);
  const components = new Map<string, PayComponent>(
    componentRows.map((r) => {
      const code = normaliseCode(r.component_code);
      return [code, { id: r.id, code, name: r.component_name, type: r.component_type, isActive: r.is_active }];
    }),
  );
  const uploaded = amounts(uploads);
  const overridden = amounts(overrides);

  const items = employees.map((e) => {
    const rule = rules.get(e.id)!;
    const bill = computeBill({
      period,
      service: e.span,
      basicFallback: e.basic_salary,
      assignments: assignments.get(e.id) ?? [],
      leave: leave.get(e.id) ?? [],
      daRate: da ? { id: da.id, percentage: da.percentage } : null,
      pfRate: pf ? { id: pf.id, percentage: pf.percentage } : null,
      medicalAmount: medical,
      hra: rule.hra,
      cca: rule.cca,
      uploaded: uploaded.get(e.id) ?? new Map(),
      overrides: overridden.get(e.id) ?? new Map(),
      components,
      minNetPercent: minNet,
      pfWageCeiling: ceiling,
      employerPfEqualsEmployee: samePf,
    });
    return { employee: e, rule, bill };
  });
  return { items, daRate: da ?? null, medicalAmount: medical, minNetPercent: minNet };
}

export type RunItem = Awaited<ReturnType<typeof computeRun>>['items'][number];
