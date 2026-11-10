/**
 * Month sheet: one row per employee, one column per day — downloaded pre-filled, edited in a
 * spreadsheet, and uploaded back. Pure functions (no React) so they can be checked in isolation.
 *
 *   Code,Name,Designation,01 Sun,02 Mon,…
 *   E001,R. Kumar,Assistant,,P,P,A,…
 *
 * Day headers are "DD Ddd" so spreadsheets keep them as text instead of turning them into dates.
 */
import type { AttendanceDay, AttendanceEmployee, AttendanceImportRow, AttendanceStatus } from '@/types/api';
import { outOfService } from './attendance';

/** Codes written to the sheet (and accepted back by the server). */
export const SHEET_CODE: Record<AttendanceStatus, string> = { PRESENT: 'P', ABSENT: 'A', LEAVE: 'L', HALF_DAY: 'HD', HOLIDAY: 'H' };
const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
/** Marks a day outside the employee's service; ignored on upload. */
export const NOT_IN_SERVICE = '-';

export function buildSheet(
  days: AttendanceDay[],
  employees: AttendanceEmployee[],
  statusOf: (employeeId: number, date: string) => AttendanceStatus | null,
): string[][] {
  const header = ['Code', 'Name', 'Designation', ...days.map((d) => `${String(d.day).padStart(2, '0')} ${DAY_NAMES[d.weekday]}`)];
  const rows = employees.map((e) => [
    e.employee_code,
    e.employee_name,
    e.designation_name,
    ...days.map((d) => {
      if (outOfService(e, d)) return NOT_IN_SERVICE;
      const s = statusOf(e.id, d.date);
      return s ? SHEET_CODE[s] : '';
    }),
  ]);
  return [header, ...rows];
}

const DAY_HEADER = /^(\d{1,2})(?:\s|$)/;

/** True when the header row looks like a month sheet (has a Code column and day columns). */
export const isMonthSheet = (header: string[]) =>
  header.some((h) => h.trim().toLowerCase() === 'code') && header.some((h) => DAY_HEADER.test(h.trim()));

/**
 * Month sheet → import rows for `year`/`month`. Blank and "-" cells are skipped (left unchanged).
 * Line numbers are the spreadsheet row numbers, so errors point at the row to fix.
 */
export function sheetToRows(table: string[][], year: number, month: number): { rows: AttendanceImportRow[]; problem: string | null } {
  const header = table[0]!.map((h) => h.trim());
  const codeCol = header.findIndex((h) => h.toLowerCase() === 'code');
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const dayCols: Array<{ col: number; day: number }> = [];
  for (let c = 0; c < header.length; c++) {
    const m = DAY_HEADER.exec(header[c]!);
    if (!m || c === codeCol) continue;
    const day = Number(m[1]);
    if (day < 1 || day > lastDay) return { rows: [], problem: `Column "${header[c]}" is not a day of this month (1–${lastDay}). Is this the sheet for another month?` };
    if (dayCols.some((d) => d.day === day)) return { rows: [], problem: `Day ${day} appears in two columns` };
    dayCols.push({ col: c, day });
  }

  const ym = `${year}-${String(month).padStart(2, '0')}`;
  const rows: AttendanceImportRow[] = [];
  for (let i = 1; i < table.length; i++) {
    const r = table[i]!;
    if (r.every((c) => c.trim() === '')) continue;
    const code = (r[codeCol] ?? '').trim();
    for (const { col, day } of dayCols) {
      const v = (r[col] ?? '').trim();
      if (v === '' || v === NOT_IN_SERVICE) continue;
      rows.push({ line: i + 1, code, date: `${ym}-${String(day).padStart(2, '0')}`, status: v });
    }
  }
  if (rows.length === 0) return { rows, problem: 'The sheet has no marks to import — fill in P, A, L, HD or H under the day columns' };
  return { rows, problem: null };
}
