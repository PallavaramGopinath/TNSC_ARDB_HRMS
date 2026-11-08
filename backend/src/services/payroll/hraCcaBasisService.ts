/**
 * HRA & CCA calculation basis (spec §3.1, §4.4, §5.1). The organisation's basis is the effective-dated
 * app setting `payroll.hra_cca.basis` (ARDB D9): a change closes the current row and adds one from the
 * next payroll period to be processed, so finalised periods keep the basis they were paid on.
 */
import { sql } from 'kysely';
import { db } from '../../config/db';
import { addDays, businessDate } from '../../lib/dates';
import { actorName, withAudit, type Actor, type Tx } from '../../lib/dbContext';
import { AppError } from '../../lib/errors';
import { clearSettingsCache, getSetting } from '../../lib/settings';
import type { HraCcaBasis } from '../../models/db.types';
import { logActivity } from '../core/activityLogService';
import { basisChangeWindow, basisLabel, HRA_CCA_BASIS_KEY, parseBasis, type PeriodState } from './hraCcaRules';

async function periodStates(trx: Tx | typeof db = db): Promise<PeriodState[]> {
  const r = await sql<PeriodState>`
    select to_char(p.from_date, 'YYYY-MM-DD') as from_date, to_char(p.to_date, 'YYYY-MM-DD') as to_date,
           p.month, p.calendar_year, p.payroll_type, p.payroll_status,
           (select count(*)::int from payroll.payrolls x where x.payroll_period_id = p.id) as bill_count
    from payroll.payroll_periods p where p.is_active`.execute(trx);
  return r.rows;
}

/** Basis in force on a date (default: business date). Payroll uses the period's end date. */
export async function basisOn(date: string = businessDate()): Promise<HraCcaBasis> {
  return parseBasis(await getSetting<string>(HRA_CCA_BASIS_KEY, 'PLACE', date));
}

/** Date from which a basis change would apply: the next payroll period to be processed. */
export async function nextPeriodStart(): Promise<string> {
  return basisChangeWindow(await periodStates(), businessDate()).effectiveFrom;
}

/**
 * The basis the rates screen works in: the one that applies to the next payroll to be processed.
 * (Can differ from today's basis right after a change, until that period starts.)
 */
export async function activeBasis(): Promise<HraCcaBasis> {
  return basisOn(await nextPeriodStart());
}

/** Places or designations that have serving employees on `asOn` but no current active rate (spec §4.3, §5.4). */
export async function coverage(basis: HraCcaBasis, asOn: string = businessDate()) {
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
    basis,
    asOn,
    keysWithEmployees: keysWithEmployees.rows[0]?.n ?? 0,
    missing: rows.rows.map((r) => ({
      keyId: r.key_id,
      // A branch with no place category can never get a PLACE rate; say so instead of a blank name.
      keyName: r.key_name ?? 'Branch has no place category',
      employeeCount: r.employee_count,
    })),
  };
}

export async function status() {
  const periods = await periodStates();
  const window = basisChangeWindow(periods, businessDate());
  const basis = await basisOn(window.effectiveFrom);
  const counts = await sql<{ rate_basis: HraCcaBasis; n: number }>`
    select rate_basis, count(*)::int as n from payroll.payroll_hra_cca_rates where is_active group by rate_basis`.execute(db);
  const row = await db
    .selectFrom('core.app_settings')
    .select(['effective_from', 'created_by', 'created_at', 'updated_by', 'updated_at'])
    .where('key', '=', HRA_CCA_BASIS_KEY)
    .where('effective_from', '<=', window.effectiveFrom)
    .orderBy('effective_from', 'desc')
    .executeTakeFirst();
  const countOf = (b: HraCcaBasis) => counts.rows.find((c) => c.rate_basis === b)?.n ?? 0;
  return {
    basis,
    basisFrom: row?.effective_from ?? null,
    todayBasis: await basisOn(),
    effectiveFrom: window.effectiveFrom,
    canChange: window.canChange,
    blockedReason: window.blockedReason,
    rateCounts: { PLACE: countOf('PLACE'), DESIGNATION: countOf('DESIGNATION') },
    lastChangedBy: row ? (row.updated_by ?? row.created_by) : null,
    lastChangedAt: row ? (row.updated_at ?? row.created_at) : null,
  };
}

/** Change the basis from the next payroll period (spec §4.4). 409 while a payroll run is open. */
export async function change(actor: Actor, basis: HraCcaBasis) {
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
    const old = parseBasis(inForce?.value);
    if (inForce && old === basis) throw AppError.badRequest(`The basis is already ${basisLabel(basis)} from ${from}`);

    // Pending changes after `from` are superseded by this one.
    const later = rows.filter((r) => r.effective_from > from).map((r) => r.id);
    if (later.length) await trx.deleteFrom('core.app_settings').where('id', 'in', later).execute();

    const who = actorName(actor);
    if (inForce && inForce.effective_from === from) {
      await trx
        .updateTable('core.app_settings')
        .set({ value: JSON.stringify(basis), effective_to: null, updated_by: who, updated_at: new Date() })
        .where('id', '=', inForce.id)
        .execute();
    } else {
      if (inForce) await trx.updateTable('core.app_settings').set({ effective_to: addDays(from, -1), updated_by: who, updated_at: new Date() }).where('id', '=', inForce.id).execute();
      await trx
        .insertInto('core.app_settings')
        .values({
          module: 'payroll',
          key: HRA_CCA_BASIS_KEY,
          value: JSON.stringify(basis),
          description: 'HRA/CCA rate looked up by PLACE (branch place category) or DESIGNATION',
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
        summary: `HRA/CCA basis ${old} → ${basis} from ${from}`,
        details: { old, new: basis, effectiveFrom: from },
      },
      trx,
    );
  });
  clearSettingsCache();
  return status();
}
