/** Locks a SALARY period for a change; one that no longer accepts the change is refused. */
import type { Tx } from '../../lib/dbContext';
import { AppError } from '../../lib/errors';
import { salaryOnly } from './payrollRunService';

export async function lockPeriod(trx: Tx, id: number) {
  const p = await trx.selectFrom('payroll.payroll_periods').selectAll().where('id', '=', id).forUpdate().executeTakeFirst();
  if (!p) throw AppError.notFound('Payroll period not found');
  salaryOnly(p, 'Payroll Preparation is');
  if (!p.is_active) throw AppError.conflict('This payroll period is inactive.');
  return p;
}

export const isEditable = (p: { payroll_status: string }) => p.payroll_status === 'OPEN' || p.payroll_status === 'PROCESSED';

/** Inputs (attendance, deductions) can change only until the run is approved. */
export async function lockForInput(trx: Tx, id: number, what: string) {
  const p = await lockPeriod(trx, id);
  if (!isEditable(p)) throw AppError.conflict(`${what} cannot be edited after the period is approved. Reverse the approval first.`);
  return p;
}

/** 409 that the screen answers by asking the user and sending the request again, confirmed. */
export const confirmOverwrite = (details: Record<string, number>, message: string) => new AppError(409, message, 'CONFIRM_OVERWRITE', details);
