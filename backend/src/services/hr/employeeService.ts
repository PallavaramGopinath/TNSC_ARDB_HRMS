/**
 * Employees — port of TNCU TNCU.Business/HR/EmployeeService.cs with the ARDB changes:
 *  - no Party (KYC) Master: KYC and bank fields live on the employee (D12)
 *  - employee code generated here: {hr.employee_code_prefix}{n padded to hr.employee_code_pad}
 *  - self-service login provisioning deferred
 */
import { sql } from 'kysely';
import { db } from '../../config/db';
import { businessDate } from '../../lib/dates';
import { actorName, withAudit, type Actor, type Tx } from '../../lib/dbContext';
import { AppError } from '../../lib/errors';
import { getSetting } from '../../lib/settings';
import type { EmployeeTable } from '../../models/db.types';
import type { EmployeeInput, EmployeeQuery } from '../../models/hr/employee.schema';
import { hasErrors, validateEmployee, type FieldErrors } from './employeeRules';

const invalid = (errors: FieldErrors) => new AppError(400, 'Validation failed', 'VALIDATION', errors);

/** camelCase input → snake_case columns (every input key maps 1:1 to a column). */
function toColumns(i: EmployeeInput): Partial<Record<keyof EmployeeTable, unknown>> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(i)) {
    if (v === undefined) continue;
    out[k.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`)] = v;
  }
  return out as Partial<Record<keyof EmployeeTable, unknown>>;
}

// ------------------------------------------------------------------------------------- queries
const listSelect = () =>
  db
    .selectFrom('hr.employees as e')
    .innerJoin('core.branches as b', 'b.id', 'e.branch_id')
    .innerJoin('hr.employee_designations as d', 'd.id', 'e.designation_id');

export async function list(q: EmployeeQuery) {
  let base = listSelect();
  if (q.branchId) base = base.where('e.branch_id', '=', q.branchId);
  if (q.designationId) base = base.where('e.designation_id', '=', q.designationId);
  if (q.status === 'active') base = base.where('e.date_of_leaving', 'is', null);
  if (q.status === 'left') base = base.where('e.date_of_leaving', 'is not', null);
  if (q.q) {
    const term = `%${q.q}%`;
    base = base.where((eb) =>
      eb.or([eb('e.employee_code', 'ilike', term), eb('e.employee_name', 'ilike', term), eb('e.epf_number', 'ilike', term)]),
    );
  }

  const [items, total] = await Promise.all([
    base
      .select([
        'e.id', 'e.employee_code', 'e.employee_name', 'e.gender', 'e.mobile', 'e.date_of_joining', 'e.date_of_retirement',
        'e.date_of_leaving', 'e.basic_salary', 'e.epf_number', 'e.branch_id', 'b.name as branch_name',
        'e.designation_id', 'd.designation_name',
      ])
      .orderBy('e.employee_code')
      .limit(q.pageSize)
      .offset((q.page - 1) * q.pageSize)
      .execute(),
    base.select((eb) => eb.fn.countAll<string>().as('n')).executeTakeFirstOrThrow(),
  ]);
  return { items, total: Number(total.n), page: q.page, pageSize: q.pageSize };
}

export async function get(id: number) {
  const row = await db
    .selectFrom('hr.employees as e')
    .innerJoin('core.branches as b', 'b.id', 'e.branch_id')
    .innerJoin('hr.employee_designations as d', 'd.id', 'e.designation_id')
    .leftJoin('hr.bank_masters as bm', 'bm.id', 'e.bank_master_id')
    .leftJoin('hr.employee_designations as cd', 'cd.id', 'e.confirmed_against_designation_id')
    .selectAll('e')
    .select(['b.name as branch_name', 'd.designation_name', 'bm.bank_name', 'cd.designation_name as confirmed_against_designation_name'])
    .where('e.id', '=', id)
    .executeTakeFirst();
  if (!row) throw AppError.notFound('Employee not found');
  return row;
}

export async function serviceHistory(employeeId: number) {
  return db
    .selectFrom('hr.employee_service_histories as h')
    .leftJoin('core.branches as b', 'b.id', 'h.branch_id')
    .leftJoin('hr.employee_designations as d', 'd.id', 'h.designation_id')
    .select([
      'h.id', 'h.effective_date', 'h.service_event', 'h.basic_pay', 'h.leave_type', 'h.leave_from_date', 'h.leave_to_date',
      'h.leave_no_of_days', 'h.remarks', 'h.created_by', 'h.created_at', 'h.checked_by', 'b.name as branch_name', 'd.designation_name',
    ])
    .where('h.employee_id', '=', employeeId)
    .orderBy('h.effective_date', 'desc')
    .orderBy('h.id', 'desc')
    .execute();
}

// ------------------------------------------------------------------------------------- checks
/** DB-backed checks shared by create and update. `current` is the stored row on update. */
async function checkReferences(trx: Tx, i: EmployeeInput, current?: { designation_id: number; branch_id: number; bank_master_id: number | null }) {
  const errs: FieldErrors = {};

  const desig = await trx.selectFrom('hr.employee_designations').select(['is_active']).where('id', '=', i.designationId).executeTakeFirst();
  if (!desig) errs.designationId = ['Designation not found'];
  else if (!desig.is_active && current?.designation_id !== i.designationId) errs.designationId = ['Designation is inactive'];

  const branch = await trx.selectFrom('core.branches').select(['is_active']).where('id', '=', i.branchId).executeTakeFirst();
  if (!branch) errs.branchId = ['Branch not found'];
  else if (!branch.is_active && current?.branch_id !== i.branchId) errs.branchId = ['Branch is inactive'];

  if (i.confirmedAgainstDesignationId) {
    const cd = await trx.selectFrom('hr.employee_designations').select('id').where('id', '=', i.confirmedAgainstDesignationId).executeTakeFirst();
    if (!cd) errs.confirmedAgainstDesignationId = ['Unknown designation'];
  }

  if (i.bankMasterId) {
    const bank = await trx.selectFrom('hr.bank_masters').select(['ifsc_for_bank', 'is_active']).where('id', '=', i.bankMasterId).executeTakeFirst();
    if (!bank) errs.bankMasterId = ['Bank not found'];
    else {
      if (!bank.is_active && current?.bank_master_id !== i.bankMasterId) errs.bankMasterId = ['This bank is deactivated'];
      if (i.ifscCode && !i.ifscCode.startsWith(bank.ifsc_for_bank))
        errs.ifscCode = [`IFSC must start with ${bank.ifsc_for_bank} for the chosen bank`];
    }
  }

  if (i.deceasedEmployeeId) {
    // TNCU: a linked deceased must have an active DEATH retirement. Retirements are not ported yet.
    const death = await trx
      .selectFrom('hr.employee_retirements')
      .select('id')
      .where('employee_id', '=', i.deceasedEmployeeId)
      .where('is_active', '=', true)
      .where('retirement_mode', '=', 'DEATH')
      .executeTakeFirst();
    if (!death) errs.deceasedEmployeeId = ['The linked employee has no recorded death retirement; enter the deceased details as text instead'];
  }
  return errs;
}

async function rules(i: EmployeeInput) {
  const minAge = await getSetting<number>('hr.min_age_at_joining', 18);
  return validateEmployee(i, { businessDate: businessDate(), minAgeAtJoining: Number(minAge) });
}

/** Linking a deceased employee replaces the free-text deceased details (TNCU). */
function normaliseDeceased(i: EmployeeInput): EmployeeInput {
  return i.deceasedEmployeeId ? { ...i, deceasedName: null, deceasedDesignation: null, deceasedDateOfDeath: null } : i;
}

async function nextEmployeeCode(trx: Tx): Promise<string> {
  const prefix = String(await getSetting<string>('hr.employee_code_prefix', 'EMP'));
  const pad = Number(await getSetting<number>('hr.employee_code_pad', 3));
  // Serialise code generation across concurrent creates.
  await sql`select pg_advisory_xact_lock(hashtext('hr.employee_code'))`.execute(trx);
  const row = await trx
    .selectFrom('hr.employees')
    .select(sql<string | null>`max(substring(employee_code from ${prefix.length + 1}::int)::int)`.as('n'))
    .where('employee_code', '~', `^${prefix.replace(/[^A-Za-z0-9]/g, '')}[0-9]+$`)
    .executeTakeFirst();
  const next = Number(row?.n ?? 0) + 1;
  return `${prefix}${String(next).padStart(pad, '0')}`;
}

// ------------------------------------------------------------------------------------- writes
export async function create(actor: Actor, raw: EmployeeInput) {
  if (raw.dateOfLeaving) throw invalid({ dateOfLeaving: ['Date of leaving cannot be set when creating an employee'] });
  const input = normaliseDeceased(raw);
  const ruleErrs = await rules(input);
  if (hasErrors(ruleErrs)) throw invalid(ruleErrs);

  const id = await withAudit(actor, async (trx) => {
    const refErrs = await checkReferences(trx, input);
    if (hasErrors(refErrs)) throw invalid(refErrs);

    const code = await nextEmployeeCode(trx);
    const designation = await trx.selectFrom('hr.employee_designations').select('designation_name').where('id', '=', input.designationId).executeTakeFirstOrThrow();
    const row = await trx
      .insertInto('hr.employees')
      .values({
        ...(toColumns(input) as object),
        employee_code: code,
        designation: designation.designation_name,
        basic_salary: input.basicSalary ?? 0,
        created_by: actorName(actor),
      } as never)
      .returning(['id', 'branch_id', 'designation_id', 'basic_salary', 'date_of_joining'])
      .executeTakeFirstOrThrow();

    await trx
      .insertInto('hr.employee_service_histories')
      .values({
        employee_id: row.id,
        effective_date: row.date_of_joining!,
        branch_id: row.branch_id,
        designation_id: row.designation_id,
        basic_pay: row.basic_salary,
        service_event: 'APPOINTMENT',
        remarks: 'Initial appointment',
        created_by: actorName(actor),
      })
      .execute();
    return row.id;
  });
  return get(id);
}

export async function update(actor: Actor, id: number, raw: EmployeeInput) {
  const input = normaliseDeceased(raw);
  const ruleErrs = await rules(input);
  if (hasErrors(ruleErrs)) throw invalid(ruleErrs);

  await withAudit(actor, async (trx) => {
    const current = await trx.selectFrom('hr.employees').selectAll().where('id', '=', id).forUpdate().executeTakeFirst();
    if (!current) throw AppError.notFound('Employee not found');
    // TNCU: the posting moves only when a transfer's joining is recorded — never through this form.
    if (input.branchId !== current.branch_id) throw invalid({ branchId: ['Change the posting through Transfers'] });

    const refErrs = await checkReferences(trx, input, current);
    if (hasErrors(refErrs)) throw invalid(refErrs);

    const newDol = input.dateOfLeaving ?? null;
    if (newDol !== current.date_of_leaving && newDol !== null) {
      const retired = await trx.selectFrom('hr.employee_retirements').select('id').where('employee_id', '=', id).where('is_active', '=', true).executeTakeFirst();
      if (retired) throw invalid({ dateOfLeaving: ['This employee has an active retirement record; change the date through Retirements'] });
      const laterPay = await trx
        .selectFrom('payroll.payrolls as p')
        .innerJoin('payroll.payroll_periods as pp', 'pp.id', 'p.payroll_period_id')
        .select('pp.from_date')
        .where('p.employee_id', '=', id)
        .where('pp.from_date', '>', newDol)
        .executeTakeFirst();
      if (laterPay) throw invalid({ dateOfLeaving: [`Payroll already exists for a period starting ${laterPay.from_date}, after this date`] });
    }

    const designation =
      input.designationId === current.designation_id
        ? current.designation
        : (await trx.selectFrom('hr.employee_designations').select('designation_name').where('id', '=', input.designationId).executeTakeFirstOrThrow()).designation_name;

    await trx
      .updateTable('hr.employees')
      .set({
        ...(toColumns({ ...input, dateOfLeaving: newDol }) as object),
        designation,
        basic_salary: input.basicSalary ?? current.basic_salary,
        updated_by: actorName(actor),
        updated_at: new Date(),
      } as never)
      .where('id', '=', id)
      .execute();
  });
  return get(id);
}
