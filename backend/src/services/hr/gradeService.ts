/**
 * Grades master (specs/03-grade-master.md). Designations hold the grade code as text (no foreign key),
 * matched trimmed and case-insensitively — always in SQL, so it agrees with ux_employee_grades_code.
 * Renaming a grade renames it on its designations too; a grade in use can be deactivated but not deleted.
 */
import { sql } from 'kysely';
import { db } from '../../config/db';
import { actorName, withAudit, type Actor, type Tx } from '../../lib/dbContext';
import { AppError } from '../../lib/errors';
import type { GradeInput, GradeQuery } from '../../models/hr/grade.schema';

const usageSql = sql<number>`(
  select count(*) from hr.employee_designations d where lower(btrim(d.grade)) = lower(btrim(g.grade_code))
)::int`;

const base = () => db.selectFrom('hr.employee_grades as g').selectAll('g').select(usageSql.as('usage_count'));

const sameCode = (column: 'grade' | 'grade_code', code: string) => sql<boolean>`lower(btrim(${sql.ref(column)})) = lower(btrim(${code}))`;

export async function list(q: GradeQuery) {
  let query = base();
  if (q.active) query = query.where('g.is_active', '=', true);
  return query.orderBy(sql`g.display_order asc nulls last`).orderBy('g.grade_code').execute();
}

export async function get(id: number) {
  const row = await base().where('g.id', '=', id).executeTakeFirst();
  if (!row) throw AppError.notFound('Grade not found');
  return row;
}

/** 409 with field details, so the form can show the message under Grade code. */
async function assertCodeFree(trx: Tx, code: string, exceptId?: number) {
  let q = trx.selectFrom('hr.employee_grades').select('grade_code').where(sameCode('grade_code', code));
  if (exceptId) q = q.where('id', '<>', exceptId);
  const existing = await q.executeTakeFirst();
  if (existing) throw new AppError(409, 'Validation failed', 'VALIDATION', { gradeCode: [`Grade '${existing.grade_code}' already exists`] });
}

const columns = (i: GradeInput) => ({
  grade_code: i.gradeCode,
  description: i.description ?? null,
  display_order: i.displayOrder ?? null,
});

const lockGrade = async (trx: Tx, id: number) => {
  const row = await trx.selectFrom('hr.employee_grades').select('grade_code').where('id', '=', id).forUpdate().executeTakeFirst();
  if (!row) throw AppError.notFound('Grade not found');
  return row;
};

export async function create(actor: Actor, input: GradeInput) {
  const id = await withAudit(actor, async (trx) => {
    await assertCodeFree(trx, input.gradeCode);
    const row = await trx
      .insertInto('hr.employee_grades')
      .values({ ...columns(input), is_active: input.isActive ?? true, created_by: actorName(actor) })
      .returning('id')
      .executeTakeFirstOrThrow();
    return row.id;
  });
  return get(id);
}

export async function update(actor: Actor, id: number, input: GradeInput) {
  await withAudit(actor, async (trx) => {
    const current = await lockGrade(trx, id);
    await assertCodeFree(trx, input.gradeCode, id);
    const stamp = { updated_by: actorName(actor), updated_at: new Date() };
    await trx
      .updateTable('hr.employee_grades')
      .set({ ...columns(input), ...(input.isActive !== undefined ? { is_active: input.isActive } : {}), ...stamp })
      .where('id', '=', id)
      .execute();
    if (input.gradeCode !== current.grade_code) {
      await trx
        .updateTable('hr.employee_designations')
        .set({ grade: input.gradeCode, ...stamp })
        .where(sameCode('grade', current.grade_code))
        .execute();
    }
  });
  return get(id);
}

export async function remove(actor: Actor, id: number): Promise<void> {
  await withAudit(actor, async (trx) => {
    const { grade_code } = await lockGrade(trx, id);
    const { n } = await trx
      .selectFrom('hr.employee_designations')
      .select((eb) => eb.fn.countAll<number>().as('n'))
      .where(sameCode('grade', grade_code))
      .executeTakeFirstOrThrow();
    if (n > 0) throw AppError.conflict(`Grade '${grade_code}' is used by ${n} designation(s) and cannot be deleted. Deactivate it instead.`);
    await trx.deleteFrom('hr.employee_grades').where('id', '=', id).execute();
  });
}
