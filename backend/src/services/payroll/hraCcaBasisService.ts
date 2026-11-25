/**
 * HRA method (specs/01 §3.1, §4.4, §5.1 as changed by specs/06 §12). The organisation's method is the
 * effective-dated app setting `payroll.hra_cca.basis` (ARDB D9): a change closes the current row and adds one
 * from the next payroll period to be processed, so finalised periods keep the method they were paid on.
 * It decides HRA only. CCA always goes by the place category of the branch.
 */
import { sql } from 'kysely';
import { db } from '../../config/db';
import { addDays, businessDate } from '../../lib/dates';
import { actorName, withAudit, type Actor, type Tx } from '../../lib/dbContext';
import { AppError } from '../../lib/errors';
import { clearSettingsCache, getSetting } from '../../lib/settings';
import type { HraCcaBasis, HraMethod } from '../../models/db.types';
import { logActivity } from '../core/activityLogService';
import { basisChangeWindow, HRA_CCA_BASIS_KEY, methodLabel, parseMethod, type PeriodState } from './hraCcaRules';

async function periodStates(trx: Tx | typeof db = db): Promise<PeriodState[]> {
  const r = await sql<PeriodState>`
    select to_char(p.from_date, 'YYYY-MM-DD') as from_date, to_char(p.to_date, 'YYYY-MM-DD') as to_date,
           p.month, p.calendar_year, p.payroll_type, p.payroll_status,
           (select count(*)::int from payroll.payrolls x where x.payroll_period_id = p.id) as bill_count
    from payroll.payroll_periods p where p.is_active`.execute(trx);
  return r.rows;
}

/** Method in force on a date (default: business date). Payroll uses the period's end date. */
export async function methodOn(date: string = businessDate()): Promise<HraMethod> {
  return parseMethod(await getSetting<string>(HRA_CCA_BASIS_KEY, 'PLACE', date));
}

/** Date from which a method change would apply: the next payroll period to be processed. */
export async function nextPeriodStart(): Promise<string> {
  return basisChangeWindow(await periodStates(), businessDate()).effectiveFrom;
}

/**
 * The method the rates screens work in: the one that applies to the next payroll to be processed.
 * (Can differ from today's method right after a change, until that period starts.)
 */
export async function activeMethod(): Promise<HraMethod> {
  return methodOn(await nextPeriodStart());
}

export interface Coverage {
  keysWithEmployees: number;
  missing: Array<{ keyId: number | null; keyName: string; employeeCount: number }>;
}

/** Places or designations that have serving employees on `asOn` but no current active rate (spec §4.3, §5.4). */
async function rateCoverage(basis: HraCcaBasis, asOn: string): Promise<Coverage> {
  const keyExpr = basis === 'PLACE' ? sql`b.place_id` : sql`e.designation_id`;
  const nameExpr = basis === 'PLACE' ? sql`pc.name` : sql`d.designation_name`;
  const rateKey = basis === 'PLACE' ? sql`r.place_id` : sql`r.designation_id`;
  const rows = await sql<{ key_id: number | null; key_name: string | null; employee_count: number }>`
    select ${keyExpr} as key_id, ${nameExpr} as key_name, count(*)::int as employee_count
    from hr.employees e
    join core.branches b on b.id = e.branch_id
    left join core.place_categories pc on pc.id = b.place_id
    join hr.employee_designations d on d.id = e.designation_id
    where (e.date_of_joining is null or e.date_of_joining <= ${asOn}::date)
      and (e.date_of_leaving is null or e.date_of_leaving >= ${asOn}::date)
      and not exists (
        select 1 from payroll.payroll_hra_cca_rates r
        where r.is_active and r.rate_basis = ${basis} and ${rateKey} = ${keyExpr}
          and r.effective_from <= ${asOn}::date and (r.effective_to is null or r.effective_to >= ${asOn}::date))
    group by 1, 2
    order by 2 nulls first`.execute(db);
  const keysWithEmployees = await sql<{ n: number }>`
    select count(distinct ${keyExpr})::int as n
    from hr.employees e join core.branches b on b.id = e.branch_id
    where (e.date_of_joining is null or e.date_of_joining <= ${asOn}::date)
      and (e.date_of_leaving is null or e.date_of_leaving >= ${asOn}::date)`.execute(db);
  return {
    keysWithEmployees: keysWithEmployees.rows[0]?.n ?? 0,
    missing: rows.rows.map((r) => ({
      keyId: r.key_id,
      // A branch with no place category can never get a PLACE rate; say so instead of a blank name.
      keyName: r.key_name ?? 'Branch has no place category',
      employeeCount: r.employee_count,
    })),
  };
}

/** Designations with serving employees but no fixed HRA amount, and employees whose branch has no place category when it matters. */
async function fixedAmountCoverage(asOn: string): Promise<Coverage> {
  const rows = await sql<{ key_id: number | null; key_name: string | null; employee_count: number }>`
    select case when a.id is null then d.id end as key_id,
           case when a.id is null then d.designation_name end as key_name,
           count(*)::int as employee_count
    from hr.employees e
    join core.branches b on b.id = e.branch_id
    join hr.employee_designations d on d.id = e.designation_id
    left join payroll.payroll_hra_amounts a on a.designation_id = d.id and a.is_active
      and a.effective_from <= ${asOn}::date and (a.effective_to is null or a.effective_to >= ${asOn}::date)
    where (e.date_of_joining is null or e.date_of_joining <= ${asOn}::date)
      and (e.date_of_leaving is null or e.date_of_leaving >= ${asOn}::date)
      and (a.id is null or (b.place_id is null and a.gcc_amount <> a.other_amount))
    group by 1, 2
    order by 2 nulls first`.execute(db);
  const total = await sql<{ n: number }>`
    select count(distinct e.designation_id)::int as n from hr.employees e
    where (e.date_of_joining is null or e.date_of_joining <= ${asOn}::date)
      and (e.date_of_leaving is null or e.date_of_leaving >= ${asOn}::date)`.execute(db);
  return {
    keysWithEmployees: total.rows[0]?.n ?? 0,
    missing: rows.rows.map((r) => ({ keyId: r.key_id, keyName: r.key_name ?? 'Branch has no place category', employeeCount: r.employee_count })),
  };
}

/** What has no rate on `asOn` under a method: HRA by the method, CCA by place (specs/06 §12.2). */
export async function coverage(method: HraMethod, asOn: string = businessDate()) {
  const cca = await rateCoverage('PLACE', asOn);
  const hra = method === 'FIXED_AMOUNT' ? await fixedAmountCoverage(asOn) : method === 'PLACE' ? cca : await rateCoverage(method, asOn);
  return { method, asOn, hra, cca };
}

export async function status() {
  const periods = await periodStates();
  const window = basisChangeWindow(periods, businessDate());
  const method = await methodOn(window.effectiveFrom);
  const counts = await sql<{ rate_basis: HraCcaBasis; n: number }>`
    select rate_basis, count(*)::int as n from payroll.payroll_hra_cca_rates where is_active group by rate_basis`.execute(db);
  const amounts = await db.selectFrom('payroll.payroll_hra_amounts').select((eb) => eb.fn.countAll<string>().as('n')).where('is_active', '=', true).executeTakeFirstOrThrow();
  const row = await db
    .selectFrom('core.app_settings')
    .select(['effective_from', 'created_by', 'created_at', 'updated_by', 'updated_at'])
    .where('key', '=', HRA_CCA_BASIS_KEY)
    .where('effective_from', '<=', window.effectiveFrom)
    .orderBy('effective_from', 'desc')
    .executeTakeFirst();
  const countOf = (b: HraCcaBasis) => counts.rows.find((c) => c.rate_basis === b)?.n ?? 0;
  return {
    method,
    methodFrom: row?.effective_from ?? null,
    todayMethod: await methodOn(),
    effectiveFrom: window.effectiveFrom,
    canChange: window.canChange,
    blockedReason: window.blockedReason,
    rateCounts: { PLACE: countOf('PLACE'), DESIGNATION: countOf('DESIGNATION'), FIXED_AMOUNT: Number(amounts.n) },
    lastChangedBy: row ? (row.updated_by ?? row.created_by) : null,
    lastChangedAt: row ? (row.updated_at ?? row.created_at) : null,
  };
}

/** Change the HRA method from the next payroll period (spec §4.4). 409 while a payroll run is open. */
export async function change(actor: Actor, method: HraMethod) {
  await withAudit(actor, async (trx) => {
    const window = basisChangeWindow(await periodStates(trx), businessDate());
    if (!window.canChange) throw AppError.conflict(window.blockedReason!);
    const from = window.effectiveFrom;

    const rows = await trx
      .selectFrom('core.app_settings')
      .select(['id', 'value', 'effective_from', 'effective_to'])
      .where('key', '=', HRA_CCA_BASIS_KEY)
      .orderBy('effective_from')
      .forUpdate()
      .execute();
    const inForce = [...rows].reverse().find((r) => r.effective_from <= from && (r.effective_to === null || r.effective_to >= from));
    const old = parseMethod(inForce?.value);
    if (inForce && old === method) throw AppError.badRequest(`The HRA method is already ${methodLabel(method)} from ${from}`);

    // Pending changes after `from` are superseded by this one.
    const later = rows.filter((r) => r.effective_from > from).map((r) => r.id);
    if (later.length) await trx.deleteFrom('core.app_settings').where('id', 'in', later).execute();

    const who = actorName(actor);
    if (inForce && inForce.effective_from === from) {
      await trx
        .updateTable('core.app_settings')
        .set({ value: JSON.stringify(method), effective_to: null, updated_by: who, updated_at: new Date() })
        .where('id', '=', inForce.id)
        .execute();
    } else {
      if (inForce) await trx.updateTable('core.app_settings').set({ effective_to: addDays(from, -1), updated_by: who, updated_at: new Date() }).where('id', '=', inForce.id).execute();
      await trx
        .insertInto('core.app_settings')
        .values({
          module: 'payroll',
          key: HRA_CCA_BASIS_KEY,
          value: JSON.stringify(method),
          description: 'HRA method: PLACE or DESIGNATION (percentage), or FIXED_AMOUNT (by designation and place). CCA always goes by place',
          effective_from: from,
          created_by: who,
        })
        .execute();
    }
    await logActivity(
      actor,
      {
        category: 'DATA_CHANGE',
        eventType: 'HRA_CCA_BASIS_CHANGED',
        module: 'payroll',
        entity: 'core.app_settings',
        entityId: HRA_CCA_BASIS_KEY,
        summary: `HRA method ${old} → ${method} from ${from}`,
        details: { old, new: method, effectiveFrom: from },
      },
      trx,
    );
  });
  clearSettingsCache();
  return status();
}
