/**
 * Bank Master — port of TNCU TNCU.Business/HR/BankMasterService.cs (ARDB D12: banks are referenced by
 * hr.employees, not party masters).
 *  - name unique ignoring case and surrounding spaces; IFSC prefix 4 letters, unique
 *  - prefix cannot change while any employee IFSC uses it
 *  - deactivate/reactivate freely; permanent delete only when no employee references the bank
 */
import { sql } from 'kysely';
import { db } from '../../config/db';
import { actorName, withAudit, type Actor, type Tx } from '../../lib/dbContext';
import { AppError } from '../../lib/errors';
import type { BankInput, BankQuery } from '../../models/hr/bankMaster.schema';

const invalid = (field: string, msg: string) => new AppError(400, 'Validation failed', 'VALIDATION', { [field]: [msg] });

const withUsage = () =>
  db
    .selectFrom('hr.bank_masters as b')
    .leftJoin('hr.employees as e', 'e.bank_master_id', 'b.id')
    .select([
      'b.id', 'b.bank_name', 'b.ifsc_for_bank', 'b.is_active', 'b.created_by', 'b.created_at', 'b.updated_by', 'b.updated_at',
      (eb) => eb.fn.count<string>('e.id').as('employee_count'),
    ])
    .groupBy('b.id');

const shape = <T extends { employee_count: string }>(r: T) => ({ ...r, employee_count: Number(r.employee_count) });

export async function list(q: BankQuery) {
  let query = withUsage();
  if (!q.includeInactive) query = query.where('b.is_active', '=', true);
  if (q.search) {
    const t = `%${q.search}%`;
    query = query.where((eb) => eb.or([eb('b.bank_name', 'ilike', t), eb('b.ifsc_for_bank', 'ilike', t)]));
  }
  return (await query.orderBy('b.bank_name').execute()).map(shape);
}

export async function get(id: number) {
  const row = await withUsage().where('b.id', '=', id).executeTakeFirst();
  if (!row) throw AppError.notFound('Bank not found');
  return shape(row);
}

async function assertUnique(trx: Tx, input: BankInput, exceptId?: number) {
  let byName = trx.selectFrom('hr.bank_masters').select('id').where(sql`lower(btrim(bank_name))`, '=', input.bankName.trim().toLowerCase());
  let byPrefix = trx.selectFrom('hr.bank_masters').select('id').where('ifsc_for_bank', '=', input.ifscForBank);
  if (exceptId) {
    byName = byName.where('id', '<>', exceptId);
    byPrefix = byPrefix.where('id', '<>', exceptId);
  }
  if (await byName.executeTakeFirst()) throw invalid('bankName', 'A bank with this name already exists');
  if (await byPrefix.executeTakeFirst()) throw invalid('ifscForBank', 'Another bank already uses this IFSC prefix');
}

export async function create(actor: Actor, input: BankInput) {
  const id = await withAudit(actor, async (trx) => {
    await assertUnique(trx, input);
    const row = await trx
      .insertInto('hr.bank_masters')
      .values({ bank_name: input.bankName.trim(), ifsc_for_bank: input.ifscForBank, is_active: input.isActive ?? true, created_by: actorName(actor) })
      .returning('id')
      .executeTakeFirstOrThrow();
    return row.id;
  });
  return get(id);
}

export async function update(actor: Actor, id: number, input: BankInput) {
  await withAudit(actor, async (trx) => {
    const current = await trx.selectFrom('hr.bank_masters').select(['ifsc_for_bank']).where('id', '=', id).forUpdate().executeTakeFirst();
    if (!current) throw AppError.notFound('Bank not found');
    await assertUnique(trx, input, id);

    if (input.ifscForBank !== current.ifsc_for_bank) {
      const inUse = await trx
        .selectFrom('hr.employees')
        .select(({ fn }) => fn.countAll<string>().as('n'))
        .where('ifsc_code', 'like', `${current.ifsc_for_bank}%`)
        .executeTakeFirstOrThrow();
      if (Number(inUse.n) > 0)
        throw invalid('ifscForBank', `The prefix cannot change while ${inUse.n} employee IFSC code(s) start with ${current.ifsc_for_bank}`);
    }

    await trx
      .updateTable('hr.bank_masters')
      .set({
        bank_name: input.bankName.trim(),
        ifsc_for_bank: input.ifscForBank,
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
  const res = await withAudit(actor, (trx) =>
    trx.updateTable('hr.bank_masters').set({ is_active: isActive, updated_by: actorName(actor), updated_at: new Date() }).where('id', '=', id).executeTakeFirst(),
  );
  if (!res.numUpdatedRows) throw AppError.notFound('Bank not found');
  return get(id);
}

export async function deletePermanent(actor: Actor, id: number) {
  await withAudit(actor, async (trx) => {
    const bank = await trx.selectFrom('hr.bank_masters').select('bank_name').where('id', '=', id).forUpdate().executeTakeFirst();
    if (!bank) throw AppError.notFound('Bank not found');
    const used = await trx
      .selectFrom('hr.employees')
      .select(({ fn }) => fn.countAll<string>().as('n'))
      .where('bank_master_id', '=', id)
      .executeTakeFirstOrThrow();
    if (Number(used.n) > 0)
      throw AppError.conflict(`${bank.bank_name} is used by ${used.n} employee(s) and cannot be deleted. Deactivate it instead.`);
    await trx.deleteFrom('hr.bank_masters').where('id', '=', id).execute();
  });
}
