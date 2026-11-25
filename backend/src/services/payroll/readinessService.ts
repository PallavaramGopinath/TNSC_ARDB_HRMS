/** Upload status of a SALARY period (specs/08 §4.2). For information: it does not stop Prepare. */
import { db } from '../../config/db';
import { AppError } from '../../lib/errors';
import { D, toMoneyString, ZERO } from '../../lib/money';
import { eligible, savedAmounts } from './periodDeductionService';
import { employeesInService, salaryOnly } from './payrollRunService';

const earliest = (dates: unknown[]) => (dates.length ? new Date(Math.min(...dates.map((d) => (d as Date).getTime()))) : null);

export async function readiness(periodId: number) {
  const p = await db.selectFrom('payroll.payroll_periods').selectAll().where('id', '=', periodId).executeTakeFirst();
  if (!p) throw AppError.notFound('Payroll period not found');
  salaryOnly(p, 'Upload status is');
  const [employees, entries, rows, saved] = await Promise.all([
    employeesInService(db, { from: p.from_date, to: p.to_date }),
    db.selectFrom('payroll.payroll_period_attendances').select(['employee_id', 'created_at']).where('payroll_period_id', '=', periodId).execute(),
    eligible(db, p),
    savedAmounts(db, periodId),
  ]);
  const inRun = new Set(employees.map((e) => e.id));
  const entered = entries.filter((a) => inRun.has(a.employee_id));

  const groups = new Map<number, typeof rows>();
  for (const r of rows) groups.set(r.component.id, [...(groups.get(r.component.id) ?? []), r]);
  const agencies = [...groups.values()]
    .map((list) => {
      const { component } = list[0]!;
      const uploads = list.flatMap((r) => saved.get(`${r.employeeId}|${component.id}`) ?? []);
      const amounts = list.map((r) => D(saved.get(`${r.employeeId}|${component.id}`)?.amount ?? r.assigned));
      return {
        componentId: component.id, code: component.code, name: component.name,
        uploaded: uploads.length, eligible: list.length,
        amount: toMoneyString(amounts.reduce((s, a) => s.plus(a), ZERO)),
        employees: amounts.filter((a) => a.gt(0)).length,
        firstUploadedAt: earliest(uploads.map((u) => u.created_at)),
      };
    })
    .sort((a, b) => a.code.localeCompare(b.code));

  const status = entered.length === 0 ? 'NOT_UPLOADED' : entered.length < employees.length ? 'PARTIAL' : 'UPLOADED';
  return {
    periodId,
    attendance: { status, entered: entered.length, total: employees.length, firstUploadedAt: earliest(entered.map((e) => e.created_at)) },
    agencies,
    message:
      status === 'NOT_UPLOADED' ? 'Upload attendance before preparing.'
      : agencies.some((a) => a.employees === 0) ? 'Ready — but check the ₹0 agencies below.'
      : 'Ready to prepare.',
  };
}
