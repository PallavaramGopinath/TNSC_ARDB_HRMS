/**
 * Daily attendance rules (pure — unit tested in tests/attendanceRules.test.ts).
 * TNCU: one row per employee per day. ARDB additions: no marking outside service, no future
 * dates except holidays, and no changes inside an APPROVED or LOCKED salary period.
 */
import type { AttendanceStatusValue } from '../../models/hr/attendance.schema';

export interface ServiceSpan {
  date_of_joining: string | null;
  date_of_leaving: string | null;
}

export interface LockedRange {
  from: string;
  to: string;
  status: string;
}

/** A date inside a locked salary period, or undefined. Dates are 'YYYY-MM-DD' so string comparison is safe. */
export const lockFor = (date: string, locks: readonly LockedRange[]) => locks.find((l) => date >= l.from && date <= l.to);

/** Error message for one attendance entry, or null if it may be saved. `status` null means "clear the day". */
export function checkEntry(
  emp: ServiceSpan,
  date: string,
  status: AttendanceStatusValue | null,
  today: string,
  locks: readonly LockedRange[],
): string | null {
  if (emp.date_of_joining && date < emp.date_of_joining) return `Before the date of joining (${emp.date_of_joining})`;
  if (emp.date_of_leaving && date > emp.date_of_leaving) return `After the date of leaving (${emp.date_of_leaving})`;
  if (status && status !== 'HOLIDAY' && date > today) return 'Only holidays can be marked for future dates';
  const lock = lockFor(date, locks);
  if (lock) return `Payroll for ${lock.from.slice(0, 7)} is ${lock.status.toLowerCase()}; attendance can no longer change`;
  return null;
}

/** 'YYYY-MM-DD', 'DD-MM-YYYY' or 'DD/MM/YYYY' → 'YYYY-MM-DD', or null if not a real date. */
export function parseFlexibleDate(raw: string): string | null {
  const s = raw.trim();
  let y: number, m: number, d: number;
  let match = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s);
  if (match) [y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])];
  else if ((match = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/.exec(s))) [d, m, y] = [Number(match[1]), Number(match[2]), Number(match[3])];
  else return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}
