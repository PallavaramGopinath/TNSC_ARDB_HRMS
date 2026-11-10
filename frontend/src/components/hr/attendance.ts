import type { AttendanceDay, AttendanceEmployee, AttendanceStatus } from '@/types/api';

export interface StatusMeta { code: string; label: string; cell: string; chip: string }

/** Display for each status: short code, label, grid cell and brush-chip colours. */
export const STATUS: Record<AttendanceStatus, StatusMeta> = {
  PRESENT: { code: 'P', label: 'Present', cell: 'bg-success-50 text-success-700', chip: 'bg-success-600 text-white' },
  ABSENT: { code: 'A', label: 'Absent', cell: 'bg-danger-50 text-danger-700', chip: 'bg-danger-600 text-white' },
  LEAVE: { code: 'L', label: 'Leave', cell: 'bg-brand-50 text-brand-700', chip: 'bg-brand-600 text-white' },
  HALF_DAY: { code: '½', label: 'Half day', cell: 'bg-warning-50 text-warning-700', chip: 'bg-warning-500 text-white' },
  HOLIDAY: { code: 'H', label: 'Holiday', cell: 'bg-ink-100 text-ink-600', chip: 'bg-ink-600 text-white' },
};
export const STATUS_ORDER: AttendanceStatus[] = ['PRESENT', 'ABSENT', 'LEAVE', 'HALF_DAY', 'HOLIDAY'];

/** Brush: a status to paint, or null to clear. */
export type Brush = AttendanceStatus | null;

export const cellKey = (employeeId: number, date: string) => `${employeeId}|${date}`;

export const isSunday = (d: AttendanceDay) => d.weekday === 0;
export const WEEKDAY = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

/** Why a cell cannot take `brush` (mirrors the server's attendanceRules.checkEntry), or null. */
export function blockReason(emp: AttendanceEmployee, day: AttendanceDay, brush: Brush, today: string): string | null {
  if (emp.date_of_joining && day.date < emp.date_of_joining) return 'Before joining';
  if (emp.date_of_leaving && day.date > emp.date_of_leaving) return 'After leaving';
  if (day.locked) return 'Payroll approved — locked';
  if (brush && brush !== 'HOLIDAY' && day.date > today) return 'Future date — only holidays';
  return null;
}

/** Outside the employee's service — the cell is shown hatched and never editable. */
export const outOfService = (emp: AttendanceEmployee, day: AttendanceDay) =>
  (!!emp.date_of_joining && day.date < emp.date_of_joining) || (!!emp.date_of_leaving && day.date > emp.date_of_leaving);
