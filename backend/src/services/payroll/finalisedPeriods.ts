/** Finalised (APPROVED or LOCKED) payroll periods, as they limit changes to effective-dated rates. */
import { db } from '../../config/db';
import type { Actor, Tx } from '../../lib/dbContext';
import { AppError } from '../../lib/errors';
import { periodLabel } from './hraCcaRules';

export type Conn = Tx | typeof db;

/** A finalised payroll period overlapping [from, to]. */
export async function finalisedPeriodOverlapping(c: Conn, from: string, to: string | null) {
  return c
    .selectFrom('payroll.payroll_periods')
    .select(['id', 'month', 'calendar_year', 'from_date', 'to_date'])
    .where('payroll_status', 'in', ['APPROVED', 'LOCKED'])
    .where('is_active', '=', true)
    .where('to_date', '>=', from)
    .$if(to !== null, (q) => q.where('from_date', '<=', to!))
    .orderBy('from_date', 'desc')
    .executeTakeFirst();
}

export const usedInFinalisedPayroll = async (c: Conn, r: { effective_from: string; effective_to: string | null }) =>
  !!(await finalisedPeriodOverlapping(c, r.effective_from, r.effective_to));

/** Effective-from inside a finalised period: refused, unless the user may back-date (Admin) → warning. */
export async function checkBackdate(c: Conn, actor: Actor, from: string): Promise<string[]> {
  const p = await finalisedPeriodOverlapping(c, from, from);
  if (!p) return [];
  if (!actor.user?.isAdmin)
    throw new AppError(400, 'Validation failed', 'VALIDATION', { effectiveFrom: [`This date is in a finalised period (${periodLabel(p)}).`] });
  return [`Effective-from falls in the finalised period ${periodLabel(p)}; arrears will be needed for finalised months.`];
}
