import clsx from 'clsx';
import { CalendarCheck, Lock } from 'lucide-react';
import { useEffect, useRef } from 'react';
import type { AttendanceMonth, AttendanceStatus } from '@/types/api';
import { cellKey, isSunday, outOfService, STATUS, STATUS_ORDER, WEEKDAY } from './attendance';

export interface Cell { employeeId: number; date: string }

interface Props {
  data: AttendanceMonth;
  /** Effective status for a cell (saved value overlaid with unsaved edits). */
  statusOf: (employeeId: number, date: string) => AttendanceStatus | null;
  edited: ReadonlySet<string>;
  errors: ReadonlyMap<string, string>;
  canEdit: boolean;
  onPaint: (cells: Cell[]) => void;
  onFillRow: (employeeId: number) => void;
}

/**
 * Month grid: employees × days. Click or drag across cells to paint them with the current brush;
 * click a day header to paint the whole column. Totals on the right, present count per day below.
 */
export function AttendanceGrid({ data, statusOf, edited, errors, canEdit, onPaint, onFillRow }: Props) {
  const painting = useRef(false);
  useEffect(() => {
    const stop = () => { painting.current = false; };
    window.addEventListener('mouseup', stop);
    return () => window.removeEventListener('mouseup', stop);
  }, []);

  const { days, employees, today } = data;

  if (employees.length === 0)
    return <div className="card px-4 py-10 text-center text-sm text-ink-400">No employees served in this branch during the month</div>;

  return (
    <div className="card overflow-x-auto select-none" onMouseLeave={() => { painting.current = false; }}>
      <table className="border-separate border-spacing-0 text-xs">
        <thead>
          <tr className="text-ink-500">
            <th className="sticky left-0 z-20 min-w-56 border-b border-r border-ink-200 bg-ink-50 px-3 py-2 text-left font-semibold uppercase tracking-wide">Employee</th>
            {days.map((d) => (
              <th
                key={d.date}
                scope="col"
                className={clsx('border-b border-ink-200 px-0 py-1 font-semibold', isSunday(d) ? 'bg-ink-100' : 'bg-ink-50', d.date === today && 'bg-brand-50 text-brand-700')}
              >
                <button
                  type="button"
                  disabled={!canEdit || d.locked}
                  title={d.locked ? 'Payroll approved — locked' : canEdit ? `Apply brush to everyone on ${d.date}` : d.date}
                  onClick={() => onPaint(employees.map((e) => ({ employeeId: e.id, date: d.date })))}
                  className="flex w-8 flex-col items-center leading-tight enabled:hover:text-brand-700 disabled:cursor-default"
                >
                  <span className="text-[10px] font-normal">{WEEKDAY[d.weekday]}</span>
                  <span className="tabular-nums">{d.day}</span>
                  {d.locked && <Lock size={9} className="text-ink-400" />}
                </button>
              </th>
            ))}
            {STATUS_ORDER.map((s) => (
              <th key={s} title={STATUS[s].label} className="border-b border-l border-ink-200 bg-ink-50 px-2 py-2 text-center font-semibold first-of-type:border-l">{STATUS[s].code}</th>
            ))}
            <th title="Days in service up to today with no mark" className="border-b border-ink-200 bg-ink-50 px-2 py-2 text-center font-semibold">Unmarked</th>
          </tr>
        </thead>
        <tbody>
          {employees.map((emp) => {
            const counts: Record<AttendanceStatus, number> = { PRESENT: 0, ABSENT: 0, LEAVE: 0, HALF_DAY: 0, HOLIDAY: 0 };
            let unmarked = 0;
            const cells = days.map((d) => {
              const s = statusOf(emp.id, d.date);
              const out = outOfService(emp, d);
              if (s) counts[s]++;
              else if (!out && d.date <= today) unmarked++;
              return { d, s, out };
            });
            const transferred = emp.branch_id !== data.branch.id;
            return (
              <tr key={emp.id} className="group">
                <th scope="row" className="sticky left-0 z-10 border-b border-r border-ink-100 bg-white px-3 py-1.5 text-left font-normal group-hover:bg-brand-25">
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium text-ink-900">{emp.employee_name}</div>
                      <div className="truncate text-ink-500">
                        <code>{emp.employee_code}</code> · {emp.designation_name}
                        {transferred && <span className="ml-1 text-warning-700" title="Now posted to another branch">· transferred</span>}
                      </div>
                    </div>
                    {canEdit && (
                      <button
                        type="button"
                        onClick={() => onFillRow(emp.id)}
                        title="Mark this employee's blank working days Present"
                        aria-label={`Fill blank working days present for ${emp.employee_name}`}
                        className="shrink-0 rounded p-1 text-ink-400 opacity-0 hover:bg-success-50 hover:text-success-700 focus:opacity-100 group-hover:opacity-100"
                      >
                        <CalendarCheck size={14} />
                      </button>
                    )}
                  </div>
                </th>
                {cells.map(({ d, s, out }) => {
                  const k = cellKey(emp.id, d.date);
                  const err = errors.get(k);
                  const editable = canEdit && !out && !d.locked;
                  return (
                    <td
                      key={d.date}
                      title={err ?? (out ? 'Not in service' : s ? STATUS[s].label : d.date)}
                      onMouseDown={(e) => { if (!editable || e.button !== 0) return; painting.current = true; onPaint([{ employeeId: emp.id, date: d.date }]); }}
                      onMouseEnter={() => { if (painting.current && editable) onPaint([{ employeeId: emp.id, date: d.date }]); }}
                      className={clsx(
                        'h-9 w-8 border-b border-ink-100 p-0.5 text-center',
                        isSunday(d) && 'bg-ink-50',
                        editable ? 'cursor-pointer' : 'cursor-not-allowed',
                      )}
                    >
                      {out ? (
                        <div className="h-full w-full rounded bg-[repeating-linear-gradient(45deg,theme(colors.ink.100)_0_3px,transparent_3px_6px)]" />
                      ) : (
                        <div
                          className={clsx(
                            'flex h-full w-full items-center justify-center rounded font-bold',
                            s ? STATUS[s].cell : 'text-ink-300 hover:bg-ink-100',
                            edited.has(k) && 'ring-2 ring-inset ring-brand-400',
                            err && 'ring-2 ring-inset ring-danger-500',
                            d.locked && 'opacity-60',
                          )}
                        >
                          {s ? STATUS[s].code : '·'}
                        </div>
                      )}
                    </td>
                  );
                })}
                {STATUS_ORDER.map((st) => (
                  <td key={st} className="border-b border-l border-ink-100 px-2 text-center tabular-nums text-ink-700 first-of-type:border-l">{counts[st] || ''}</td>
                ))}
                <td className={clsx('border-b border-ink-100 px-2 text-center tabular-nums', unmarked ? 'font-semibold text-warning-700' : 'text-ink-300')}>{unmarked || '—'}</td>
              </tr>
            );
          })}
        </tbody>
        <tfoot>
          <tr className="text-ink-500">
            <th className="sticky left-0 z-10 border-r border-ink-200 bg-ink-50 px-3 py-1.5 text-left font-semibold">Present</th>
            {days.map((d) => {
              const n = employees.reduce((acc, e) => acc + (statusOf(e.id, d.date) === 'PRESENT' ? 1 : statusOf(e.id, d.date) === 'HALF_DAY' ? 0.5 : 0), 0);
              return <td key={d.date} className={clsx('py-1.5 text-center tabular-nums', isSunday(d) ? 'bg-ink-100' : 'bg-ink-50')}>{n || ''}</td>;
            })}
            <td colSpan={STATUS_ORDER.length + 1} className="bg-ink-50" />
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
