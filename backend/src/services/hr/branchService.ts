/**
 * Branch master (core.branches), managed from HR › Masters.
 *  - code unique ignoring case; it cannot change while employees are posted there
 *  - exactly one Head Office; the HO cannot be deactivated, deleted or changed to BRANCH
 *  - permanent delete only when nothing references the branch — deactivate instead
 */
import { sql } from 'kysely';
import { db } from '../../config/db';
import { actorName, withAudit, type Actor, type Tx } from '../../lib/dbContext';
import { AppError } from '../../lib/errors';
import type { BranchInput, BranchQuery } from '../../models/hr/branch.schema';

const invalid = (field: string, msg: string) => new AppError(400, 'Validation failed', 'VALIDATION', { [field]: [msg] });

const withUsage = () =>
  db
    .selectFrom('core.branches as b')
    .leftJoin('core.place_categories as p', 'p.id', 'b.place_id')
    .leftJoin('hr.employees as e', 'e.branch_id', 'b.id')
    .select([
      'b.id', 'b.code', 'b.name', 'b.type', 'b.address', 'b.district', 'b.pincode', 'b.phone', 'b.email', 'b.place_id',
      'p.name as place_name', 'b.is_active', 'b.created_by', 'b.created_at', 'b.updated_by', 'b.updated_at',
      (eb) => eb.fn.count<string>('e.id').as('employee_count'),
    ])
    .groupBy(['b.id', 'p.name']);

const shape = <T extends { employee_count: string }>(r: T) => ({ ...r, employee_count: Number(r.employee_count) });

export async function list(q: BranchQuery) {
  let query = withUsage();
  if (!q.includeInactive) query = query.where('b.is_active', '=', true);
  if (q.search) {
    const t = `%${q.search}%`;
    query = query.where((eb) => eb.or([eb('b.code', 'ilike', t), eb('b.name', 'ilike', t), eb('b.district', 'ilike', t)]));
  }
  return (await query.orderBy('b.type').orderBy('b.name').execute()).map(shape);
}

export async function get(id: number) {
  const row = await withUsage().where('b.id', '=', id).executeTakeFirst();
  if (!row) throw AppError.notFound('Branch not found');
  return shape(row);
}

async function assertValid(trx: Tx, input: BranchInput, exceptId?: number) {
  let byCode = trx.selectFrom('core.branches').select('id').where(sql`upper(code)`, '=', input.code);
  if (exceptId) byCode = byCode.where('id', '<>', exceptId);
  if (await byCode.executeTakeFirst()) throw invalid('code', 'Another branch already uses this code');

  if (input.type === 'HO') {
    let ho = trx.selectFrom('core.branches').select('name').where('type', '=', 'HO');
    if (exceptId) ho = ho.where('id', '<>', exceptId);
    const existing = await ho.executeTakeFirst();
    if (existing) throw invalid('type', `${existing.name} is already the Head Office; there can be only one`);
    if (input.isActive === false) throw invalid('isActive', 'The Head Office cannot be inactive');
  }

  if (input.placeId != null) {
    const place = await trx.selectFrom('core.place_categories').select('id').where('id', '=', input.placeId).executeTakeFirst();
    if (!place) throw invalid('placeId', 'Place category not found');
  }
}

const values = (input: BranchInput) => ({
  code: input.code,
  name: input.name.trim(),
  type: input.type,
  address: input.address ?? null,
  district: input.district ?? null,
  pincode: input.pincode ?? null,
  phone: input.phone ?? null,
  email: input.email ?? null,
  place_id: input.placeId ?? null,
});

export async function create(actor: Actor, input: BranchInput) {
  const id = await withAudit(actor, async (trx) => {
    await assertValid(trx, input);
    const row = await trx
      .insertInto('core.branches')
      .values({ ...values(input), is_active: input.isActive ?? true, created_by: actorName(actor) })
      .returning('id')
      .executeTakeFirstOrThrow();
    return row.id;
  });
  return get(id);
}

const employeesAt = async (trx: Tx, id: number) =>
  Number(
    (await trx.selectFrom('hr.employees').select(({ fn }) => fn.countAll<string>().as('n')).where('branch_id', '=', id).executeTakeFirstOrThrow()).n,
  );

export async function update(actor: Actor, id: number, input: BranchInput) {
  await withAudit(actor, async (trx) => {
    const current = await trx.selectFrom('core.branches').select(['code', 'type']).where('id', '=', id).forUpdate().executeTakeFirst();
    if (!current) throw AppError.notFound('Branch not found');
    if (current.type === 'HO' && input.type !== 'HO') throw invalid('type', 'The Head Office cannot be changed to a branch');
    await assertValid(trx, input, id);

    if (input.code !== current.code) {
      const n = await employeesAt(trx, id);
      if (n > 0) throw invalid('code', `The code cannot change while ${n} employee(s) are posted at this branch`);
    }

    await trx
      .updateTable('core.branches')
      .set({
        ...values(input),
        ...(input.isActive !== undefined ? { is_active: input.isActive } : {}),
        updated_by: actorName(actor),
        updated_at: new Date(),
      })
      .where('id', '=', id)
      .execute();
  });
  return get(id);
}

export async function setActive(actor: Actor, id: number, isActive: boolean) {
  await withAudit(actor, async (trx) => {
    const b = await trx.selectFrom('core.branches').select('type').where('id', '=', id).forUpdate().executeTakeFirst();
    if (!b) throw AppError.notFound('Branch not found');
    if (b.type === 'HO' && !isActive) throw AppError.conflict('The Head Office cannot be deactivated');
    await trx.updateTable('core.branches').set({ is_active: isActive, updated_by: actorName(actor), updated_at: new Date() }).where('id', '=', id).execute();
  });
  return get(id);
}

export async function deletePermanent(actor: Actor, id: number) {
  let name = '';
  try {
    await withAudit(actor, async (trx) => {
      const b = await trx.selectFrom('core.branches').select(['name', 'type']).where('id', '=', id).forUpdate().executeTakeFirst();
      if (!b) throw AppError.notFound('Branch not found');
      name = b.name;
      if (b.type === 'HO') throw AppError.conflict('The Head Office cannot be deleted');
      const n = await employeesAt(trx, id);
      if (n > 0) throw AppError.conflict(`${b.name} has ${n} employee(s) posted and cannot be deleted. Deactivate it instead.`);
      await trx.deleteFrom('core.branches').where('id', '=', id).execute();
    });
  } catch (e) {
    // Any other table that references the branch (users, transfers, periods, attendance…).
    if ((e as { code?: string }).code === '23503')
      throw AppError.conflict(`${name} is referenced by other records and cannot be deleted. Deactivate it instead.`);
    throw e;
  }
}
