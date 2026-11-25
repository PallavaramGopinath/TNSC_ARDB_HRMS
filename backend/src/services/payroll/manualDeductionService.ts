/** Edit deductions of one employee after Prepare (specs/08 §5.3). Edits are kept when the run is prepared again. */
import { db } from '../../config/db';
import { actorName, withAudit, type Actor } from '../../lib/dbContext';
import { AppError } from '../../lib/errors';
import { D, toMoneyString } from '../../lib/money';
import type { ManualDeductionSave } from '../../models/payroll/preparation.schema';
import type { Conn } from './finalisedPeriods';
import { isEditable, lockForInput } from './periodLock';
import { prepareIn } from './preparationService';
import { computeRun, salaryOnly, type RunPeriod } from './payrollRunService';

const overridesOf = (c: Conn, periodId: number, employeeId: number) =>
  c
    .selectFrom('payroll.payroll_manual_deduction_overrides as o')
    .innerJoin('payroll.payroll_components as c', 'c.id', 'o.component_id')
    .select(['o.id', 'o.component_id', 'o.override_amount', 'o.remarks', 'c.component_code', 'c.component_name'])
    .where('o.payroll_period_id', '=', periodId)
    .where('o.employee_id', '=', employeeId)
    .execute();

async function itemFor(c: Conn, p: RunPeriod, employeeId: number) {
  const prepared = await c.selectFrom('payroll.payrolls').select('id').where('payroll_period_id', '=', p.id).where('employee_id', '=', employeeId).executeTakeFirst();
  const run = prepared && (await computeRun(c, p));
  const item = run?.items.find((x) => x.employee.id === employeeId);
  if (!item) throw AppError.conflict('No prepared payroll row for this employee — click Prepare Payroll first.');
  return { ...item, minNetPercent: run!.minNetPercent };
}

export async function get(periodId: number, employeeId: number) {
  const p = await db.selectFrom('payroll.payroll_periods').selectAll().where('id', '=', periodId).executeTakeFirst();
  if (!p) throw AppError.notFound('Payroll period not found');
  salaryOnly(p, 'Deductions can be edited');
  const [{ employee: e, bill, rule, minNetPercent }, overrides] = await Promise.all([itemFor(db, p, employeeId), overridesOf(db, periodId, employeeId)]);
  const byComponent = new Map(overrides.map((o) => [o.component_id, o]));
  const rows = bill.editable.map((d) => {
    const o = byComponent.get(d.component.id);
    byComponent.delete(d.component.id);
    return {
      componentId: d.component.id, componentCode: d.component.code, componentName: d.component.name,
      calculated: toMoneyString(d.calculated), override: o?.override_amount ?? null, remarks: o?.remarks ?? '', applies: true,
    };
  });
  // Edits of a deduction that is no longer part of the bill: shown, so that they can be removed (§12 point 22).
  const stale = [...byComponent.values()].map((o) => ({
    componentId: o.component_id, componentCode: o.component_code, componentName: o.component_name,
    calculated: null, override: o.override_amount, remarks: o.remarks ?? '', applies: false,
  }));
  return {
    periodId, employeeId, editable: isEditable(p), employeeCode: e.employee_code, employeeName: e.employee_name, branch: rule.branch,
    gross: toMoneyString(bill.gross.minus(bill.employerPf)), net: toMoneyString(bill.net), minimumNet: toMoneyString(bill.minimumNet), minNetPercent: D(minNetPercent).toString(),
    rows: [...rows, ...stale],
  };
}

/** Saves the edits and prepares the whole run again, as one change. */
export async function saveAndPrepare(actor: Actor, periodId: number, employeeId: number, i: ManualDeductionSave) {
  return withAudit(actor, async (trx) => {
    const p = await lockForInput(trx, periodId, 'Deductions');
    const [{ bill }, existing] = await Promise.all([itemFor(trx, p, employeeId), overridesOf(trx, periodId, employeeId)]);
    const allowed = new Set(bill.editable.map((d) => d.component.id));
    for (const e of i.entries) {
      const old = existing.find((o) => o.component_id === e.componentId);
      if (e.amount === null) {
        if (old) await trx.deleteFrom('payroll.payroll_manual_deduction_overrides').where('id', '=', old.id).execute();
        continue;
      }
      const remarks = e.remarks ?? null;
      if (old && D(old.override_amount).eq(e.amount) && (old.remarks ?? '') === (remarks ?? '')) continue;
      if (!allowed.has(e.componentId)) throw AppError.badRequest('This deduction is not part of the pay bill; it can only be removed');
      await trx
        .insertInto('payroll.payroll_manual_deduction_overrides')
        .values({ payroll_period_id: periodId, employee_id: employeeId, component_id: e.componentId, override_amount: e.amount, remarks, created_by: actorName(actor) })
        .onConflict((oc) => oc.columns(['payroll_period_id', 'employee_id', 'component_id']).doUpdateSet({ override_amount: e.amount!, remarks }))
        .execute();
    }
    // Attendance was confirmed when the run was first prepared.
    return prepareIn(trx, actor, periodId, true);
  });
}
