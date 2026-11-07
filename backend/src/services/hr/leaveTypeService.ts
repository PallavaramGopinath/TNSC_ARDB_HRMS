/**
 * Leave types — port of TNCU TNCU.Business/HR/EmployeeLeaveTypeService.cs.
 * ARDB safeguard: the system codes CL/EL/ML/LOP drive the leave-credit engine, leave approval and
 * payroll proration, so their code cannot change and they cannot be deactivated or deleted.
 */
import { sql } from 'kysely';
import { db } from '../../config/db';
import { actorName, withAudit, type Actor, type Tx } from '../../lib/dbContext';
import { AppError } from '../../lib/errors';
import { SYSTEM_LEAVE_CODES } from '../../models/enums';
import type { LeaveTypeInput, LeaveTypeQuery } from '../../models/hr/leaveType.schema';

const invalid = (field: string, msg: string) => new AppError(400, 'Validation failed', 'VALIDATION', { [field]: [msg] });
export const isSystemCode = (code: string | null | undefined) => !!code && (SYSTEM_LEAVE_CODES as readonly string[]).includes(code.toUpperCase());

/** Every row that references a leave type (TNCU checks applications + balances; ARDB checks all FKs). */
const usageSql = sql<number>`(
  (select count(*) from hr.employee_leave_applications a where a.leave_type_id = lt.id) +
  (select count(*) from hr.employee_leave_balances b where b.leave_type_id = lt.id) +
  (select count(*) from hr.leave_credit_runs r where r.leave_type_id = lt.id) +
  (select count(*) from hr.leave_credit_run_employees re where re.leave_type_id = lt.id) +
  (select count(*) from payroll.payroll_period_attendance_leaves pl where pl.leave_type_id = lt.id) +
  (select count(*) from payroll.payroll_period_leave_postings pp where pp.leave_type_id = lt.id)
)::int`;

const base = () =>
  db
    .selectFrom('hr.employee_leave_types as lt')
    .selectAll('lt')
    .select(usageSql.as('usage_count'));

const shape = <T extends { leave_code: string | null; usage_count: number }>(r: T) => ({ ...r, usage_count: Number(r.usage_count), is_system: isSystemCode(r.leave_code) });

export async function list(q: LeaveTypeQuery) {
  let query = base();
  if (!q.includeInactive) query = query.where('lt.is_active', '=', true);
  const rows = await query.orderBy('lt.leave_code').execute();
  // System types first (CL, EL, ML, LOP in that order), then the rest by code.
  const rank = (c: string | null) => { const i = (SYSTEM_LEAVE_CODES as readonly string[]).indexOf(c ?? ''); return i < 0 ? 99 : i; };
  return rows.map(shape).sort((a, b) => rank(a.leave_code) - rank(b.leave_code) || (a.leave_code ?? '').localeCompare(b.leave_code ?? ''));
}

export async function get(id: number) {
  const row = await base().where('lt.id', '=', id).executeTakeFirst();
  if (!row) throw AppError.notFound('Leave type not found');
  return shape(row);
}

async function assertCodeFree(trx: Tx, code: string, exceptId?: number) {
  let q = trx.selectFrom('hr.employee_leave_types').select('id').where('leave_code', '=', code);
  if (exceptId) q = q.where('id', '<>', exceptId);
  if (await q.executeTakeFirst()) throw invalid('leaveCode', `Leave code '${code}' already exists`);
}

const columns = (i: LeaveTypeInput) => ({
  leave_name: i.leaveName,
  leave_code: i.leaveCode,
  annual_quota: i.annualQuota,
  pay_cut_factor: i.payCutFactor,
  carry_forward: i.carryForward,
  encashment_allowed: i.encashmentAllowed,
  cuts_special_pay_and_da: i.cutsSpecialPayAndDa,
  affects_leave_balance: i.affectsLeaveBalance,
});

export async function create(actor: Actor, input: LeaveTypeInput) {
  const id = await withAudit(actor, async (trx) => {
    await assertCodeFree(trx, input.leaveCode);
    const row = await trx
      .insertInto('hr.employee_leave_types')
      .values({ ...columns(input), is_active: input.isActive ?? true, created_by: actorName(actor) })
      .returning('id')
      .executeTakeFirstOrThrow();
    return row.id;
  });
  return get(id);
}

export async function update(actor: Actor, id: number, input: LeaveTypeInput) {
  await withAudit(actor, async (trx) => {
    const current = await trx.selectFrom('hr.employee_leave_types').select(['leave_code', 'is_active']).where('id', '=', id).forUpdate().executeTakeFirst();
    if (!current) throw AppError.notFound('Leave type not found');
    if (isSystemCode(current.leave_code)) {
      if (input.leaveCode !== current.leave_code) throw invalid('leaveCode', `${current.leave_code} is a system leave type; its code cannot change`);
      if (input.isActive === false) throw invalid('isActive', `${current.leave_code} is a system leave type and cannot be deactivated`);
    }
    await assertCodeFree(trx, input.leaveCode, id);
    await trx
      .updateTable('hr.employee_leave_types')
      .set({ ...columns(input), ...(input.isActive !== undefined ? { is_active: input.isActive } : {}) })
      .where('id', '=', id)
      .execute();
  });
  return get(id);
}

export async function setActive(actor: Actor, id: number, isActive: boolean) {
  await withAudit(actor, async (trx) => {
    const current = await trx.selectFrom('hr.employee_leave_types').select('leave_code').where('id', '=', id).executeTakeFirst();
    if (!current) throw AppError.notFound('Leave type not found');
    if (!isActive && isSystemCode(current.leave_code)) throw AppError.conflict(`${current.leave_code} is a system leave type and cannot be deactivated`);
    await trx.updateTable('hr.employee_leave_types').set({ is_active: isActive }).where('id', '=', id).execute();
  });
  return get(id);
}

export async function deletePermanent(actor: Actor, id: number) {
  const lt = await get(id);
  if (lt.is_system) throw AppError.conflict(`${lt.leave_code} is a system leave type and cannot be deleted`);
  if (lt.usage_count > 0)
    throw AppError.conflict(`${lt.leave_name} is used by ${lt.usage_count} leave record(s) and cannot be deleted. Deactivate it instead.`);
  await withAudit(actor, (trx) => trx.deleteFrom('hr.employee_leave_types').where('id', '=', id).execute());
}
