/**
 * Payroll print order (spec 04 §4.3) — the single ORDER BY that every payroll print (pay bill, payslips,
 * payroll reports) must use: designation seniority, then employee seniority, then employee code.
 * Blank seniority sorts last at both levels.
 *
 * The query must alias hr.employees as `e` and hr.employee_designations as `d`.
 */
import { sql } from 'kysely';

export const payrollPrintOrder = sql`d.seniority_order asc nulls last, e.seniority_order asc nulls last, e.employee_code asc`;
