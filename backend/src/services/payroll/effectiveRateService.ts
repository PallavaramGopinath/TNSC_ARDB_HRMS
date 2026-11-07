/**
 * Effective-dated percentage rates (DA, PF) — ports of TNCU PayrollDaRateService.cs and
 * PayrollPfDeductionRateService.cs, which are identical apart from table and column.
 *
 * History is append-only: a revision is added as a new active rate, which closes the current one on the
 * day before (effective_to = new from − 1). No edit, no delete. approved_by = creator (TNCU).
 */
import { sql } from 'kysely';
import { db } from '../../config/db';
import { addDays, businessDate } from '../../lib/dates';
import { actorName, withAudit, type Actor, type Tx } from '../../lib/dbContext';
import { AppError } from '../../lib/errors';

export interface EffectiveRate {
  id: number;
  effective_from: string;
  effective_to: string | null;
  percentage: string;
  is_active: boolean;
  created_by: string;
  created_at: Date;
  approved_by: string | null;
  approved_at: Date | null;
}

export interface RateConfig {
  table: 'payroll.payroll_da_rates' | 'payroll.payroll_pf_deduction_rates';
  column: 'da_percentage' | 'pf_deduction_percentage';
  label: string; // 'DA' | 'PF' — used in messages
}

const invalid = (field: string, msg: string) => new AppError(400, 'Validation failed', 'VALIDATION', { [field]: [msg] });

export function createEffectiveRateService(cfg: RateConfig) {
  const t = sql.table(cfg.table);
  const cols = sql`id, effective_from, effective_to, ${sql.ref(cfg.column)} as percentage, is_active, created_by, created_at, approved_by, approved_at`;
  const q = async (trx: Tx | typeof db, where = sql``, tail = sql``) =>
    (await sql<EffectiveRate>`select ${cols} from ${t} ${where} ${tail}`.execute(trx)).rows;

  const list = () => q(db, sql``, sql`order by effective_from desc, id desc`);
  const active = async () => (await q(db, sql`where is_active`, sql`order by effective_from desc limit 1`))[0];
  /** Rate in force on a date (payroll calculator / arrears): from ≤ date ≤ to (or open). */
  const rateOn = async (date: string) =>
    (await q(db, sql`where effective_from <= ${date} and (effective_to is null or effective_to >= ${date})`, sql`order by effective_from desc limit 1`))[0];

  async function addNewActiveRate(actor: Actor, input: { effectiveFrom: string; percentage: number }): Promise<EffectiveRate> {
    if (input.effectiveFrom > addDays(businessDate(), 366)) throw invalid('effectiveFrom', 'Effective-from is more than a year ahead; check the date');

    const id = await withAudit(actor, async (trx) => {
      const actives = await q(trx, sql`where is_active`, sql`for update`);
      for (const a of actives) {
        if (a.effective_from >= input.effectiveFrom)
          throw invalid('effectiveFrom', `The current ${cfg.label} rate is effective from ${a.effective_from}; the new rate must start after that date`);
      }
      const closeOn = addDays(input.effectiveFrom, -1);
      for (const a of actives) {
        await sql`update ${t} set is_active = false, effective_to = coalesce(effective_to, ${closeOn}::date) where id = ${a.id}`.execute(trx);
      }
      const who = actorName(actor);
      const row = await sql<{ id: number }>`
        insert into ${t} (effective_from, effective_to, ${sql.ref(cfg.column)}, is_active, created_by, approved_by, approved_at)
        values (${input.effectiveFrom}::date, null, ${input.percentage}, true, ${who}, ${who}, now())
        returning id`.execute(trx);
      return row.rows[0]!.id;
    });
    return (await q(db, sql`where id = ${id}`))[0]!;
  }

  return { list, active, rateOn, addNewActiveRate };
}
