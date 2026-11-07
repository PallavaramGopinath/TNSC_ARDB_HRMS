/**
 * Designations — reference implementation of the service layer pattern
 * (TNCU TNCU.Business/HR/DesignationService.cs): name required, seniority 1–999,
 * "delete" deactivates.
 */
import { sql } from 'kysely';
import { db } from '../../config/db';
import { actorName, withAudit, type Actor } from '../../lib/dbContext';
import { AppError } from '../../lib/errors';
import type { Designation } from '../../models/db.types';
import type { DesignationInput, DesignationQuery } from '../../models/hr/designation.schema';

export async function list(q: DesignationQuery): Promise<Designation[]> {
  let query = db.selectFrom('hr.employee_designations').selectAll();
  if (!q.includeInactive) query = query.where('is_active', '=', true);
  if (q.search) query = query.where('designation_name', 'ilike', `%${q.search}%`);
  return query.orderBy(sql`seniority_order asc nulls last`).orderBy('designation_name').execute();
}

export async function get(id: number): Promise<Designation> {
  const row = await db.selectFrom('hr.employee_designations').selectAll().where('id', '=', id).executeTakeFirst();
  if (!row) throw AppError.notFound('Designation not found');
  return row;
}

export async function create(actor: Actor, input: DesignationInput): Promise<Designation> {
  return withAudit(actor, (trx) =>
    trx
      .insertInto('hr.employee_designations')
      .values({
        designation_name: input.designationName,
        grade: input.grade ?? null,
        pay_level: input.payLevel ?? null,
        seniority_order: input.seniorityOrder ?? null,
        is_active: input.isActive ?? true,
        created_by: actorName(actor),
      })
      .returningAll()
      .executeTakeFirstOrThrow(),
  );
}

export async function update(actor: Actor, id: number, input: DesignationInput): Promise<Designation> {
  const row = await withAudit(actor, (trx) =>
    trx
      .updateTable('hr.employee_designations')
      .set({
        designation_name: input.designationName,
        grade: input.grade ?? null,
        pay_level: input.payLevel ?? null,
        seniority_order: input.seniorityOrder ?? null,
        ...(input.isActive !== undefined ? { is_active: input.isActive } : {}),
        updated_by: actorName(actor),
        updated_at: new Date(),
      })
      .where('id', '=', id)
      .returningAll()
      .executeTakeFirst(),
  );
  if (!row) throw AppError.notFound('Designation not found');
  return row;
}

/** TNCU: delete only deactivates. */
export async function deactivate(actor: Actor, id: number): Promise<void> {
  const res = await withAudit(actor, (trx) =>
    trx
      .updateTable('hr.employee_designations')
      .set({ is_active: false, updated_by: actorName(actor), updated_at: new Date() })
      .where('id', '=', id)
      .executeTakeFirst(),
  );
  if (!res.numUpdatedRows) throw AppError.notFound('Designation not found');
}
