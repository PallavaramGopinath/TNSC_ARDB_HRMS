/**
 * Payroll components (pay heads) master.
 * The codes in ComponentCode drive the payroll calculator, so for those "system" components the code and
 * type cannot change and they cannot be deactivated or deleted. Any component referenced by assignments,
 * payroll details or deductions can only be deactivated, never deleted.
 */
import { sql } from 'kysely';
import { db } from '../../config/db';
import { actorName, withAudit, type Actor, type Tx } from '../../lib/dbContext';
import { AppError } from '../../lib/errors';
import { ComponentCode } from '../../models/enums';
import type { ComponentInput, ComponentQuery } from '../../models/payroll/component.schema';

const invalid = (field: string, msg: string) => new AppError(400, 'Validation failed', 'VALIDATION', { [field]: [msg] });
const SYSTEM_CODES = new Set<string>(Object.values(ComponentCode));
export const isSystemComponent = (code: string | null | undefined) => !!code && SYSTEM_CODES.has(code.trim().toUpperCase());

const usageSql = sql<number>`(
  (select count(*) from payroll.payroll_component_assignments a where a.component_id = pc.id) +
  (select count(*) from payroll.payroll_details d where d.component_id = pc.id) +
  (select count(*) from payroll.payroll_period_deductions pd where pd.component_id = pc.id) +
  (select count(*) from payroll.payroll_manual_deduction_overrides mo where mo.component_id = pc.id)
)::int`;

const base = () => db.selectFrom('payroll.payroll_components as pc').selectAll('pc').select(usageSql.as('usage_count'));

const shape = <T extends { component_code: string; usage_count: number }>(r: T) => ({
  ...r,
  usage_count: Number(r.usage_count),
  is_system: isSystemComponent(r.component_code),
});

export async function list(q: ComponentQuery) {
  let query = base();
  if (!q.includeInactive) query = query.where('pc.is_active', '=', true);
  const rows = await query.orderBy(sql`pc.display_order asc nulls last`).orderBy('pc.component_code').execute();
  return rows.map(shape);
}

export async function get(id: number) {
  const row = await base().where('pc.id', '=', id).executeTakeFirst();
  if (!row) throw AppError.notFound('Payroll component not found');
  return shape(row);
}

async function assertCodeFree(trx: Tx, code: string, exceptId?: number) {
  let q = trx.selectFrom('payroll.payroll_components').select('id').where(sql`upper(component_code)`, '=', code.toUpperCase());
  if (exceptId) q = q.where('id', '<>', exceptId);
  if (await q.executeTakeFirst()) throw invalid('componentCode', `Component code '${code}' already exists`);
}

const columns = (i: ComponentInput) => ({
  component_name: i.componentName,
  component_code: i.componentCode,
  component_type: i.componentType,
  is_da_applicable: i.isDaApplicable,
  is_surrender_leave_applicable: i.isSurrenderLeaveApplicable,
  is_income_tax_applicable: i.isIncomeTaxApplicable,
  display_order: i.displayOrder ?? null,
  calculation_method: i.calculationMethod ?? null,
  calculation_basis: i.calculationBasis ?? null,
  minimum_amount: i.minimumAmount,
  maximum_amount: i.maximumAmount,
});

export async function create(actor: Actor, input: ComponentInput) {
  const id = await withAudit(actor, async (trx) => {
    await assertCodeFree(trx, input.componentCode);
    const row = await trx
      .insertInto('payroll.payroll_components')
      .values({ ...columns(input), is_active: input.isActive ?? true, created_by: actorName(actor) })
      .returning('id')
      .executeTakeFirstOrThrow();
    return row.id;
  });
  return get(id);
}

export async function update(actor: Actor, id: number, input: ComponentInput) {
  await withAudit(actor, async (trx) => {
    const current = await trx
      .selectFrom('payroll.payroll_components')
      .select(['component_code', 'component_type'])
      .where('id', '=', id)
      .forUpdate()
      .executeTakeFirst();
    if (!current) throw AppError.notFound('Payroll component not found');
    if (isSystemComponent(current.component_code)) {
      const code = current.component_code.toUpperCase();
      if (input.componentCode !== code) throw invalid('componentCode', `${code} is a system component; its code cannot change`);
      if (input.componentType !== current.component_type) throw invalid('componentType', `${code} is a system component; its type cannot change`);
      if (input.isActive === false) throw invalid('isActive', `${code} is a system component and cannot be deactivated`);
    }
    await assertCodeFree(trx, input.componentCode, id);
    await trx
      .updateTable('payroll.payroll_components')
      .set({ ...columns(input), ...(input.isActive !== undefined ? { is_active: input.isActive } : {}) })
      .where('id', '=', id)
      .execute();
  });
  return get(id);
}

export async function setActive(actor: Actor, id: number, isActive: boolean) {
  await withAudit(actor, async (trx) => {
    const current = await trx.selectFrom('payroll.payroll_components').select('component_code').where('id', '=', id).executeTakeFirst();
    if (!current) throw AppError.notFound('Payroll component not found');
    if (!isActive && isSystemComponent(current.component_code))
      throw AppError.conflict(`${current.component_code} is a system component and cannot be deactivated`);
    await trx.updateTable('payroll.payroll_components').set({ is_active: isActive }).where('id', '=', id).execute();
  });
  return get(id);
}

export async function deletePermanent(actor: Actor, id: number) {
  const c = await get(id);
  if (c.is_system) throw AppError.conflict(`${c.component_code} is a system component and cannot be deleted`);
  if (c.usage_count > 0)
    throw AppError.conflict(`${c.component_name} is used by ${c.usage_count} payroll record(s) and cannot be deleted. Deactivate it instead.`);
  await withAudit(actor, (trx) => trx.deleteFrom('payroll.payroll_components').where('id', '=', id).execute());
}
