import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { CalendarCheck, ChevronLeft, ChevronRight, Eraser, FileDown, FileUp, Lock, Save, Undo2 } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { AttendanceGrid, type Cell } from '@/components/hr/AttendanceGrid';
import { AttendanceImport } from '@/components/hr/AttendanceImport';
import { blockReason, cellKey, isSunday, STATUS, STATUS_ORDER, type Brush } from '@/components/hr/attendance';
import { buildSheet } from '@/components/hr/attendanceSheet';
import { Button } from '@/components/ui/Button';
import { PageHeader } from '@/components/ui/PageHeader';
import { useAuth } from '@/hooks/useAuth';
import { downloadText, toCsv } from '@/lib/csv';
import { MONTHS } from '@/lib/format';
import { errorMessage } from '@/services/api';
import { hrApi, type AttendanceEntry } from '@/services/hr';
import type { AttendanceStatus } from '@/types/api';

const todayYm = () => {
  const d = new Date();
  return { year: d.getFullYear(), month: d.getMonth() + 1 };
};

/** HR › Leave & Attendance › Attendance — monthly grid per branch, with CSV import. */
export function AttendancePage() {
  const qc = useQueryClient();
  const { user } = useAuth();
  const canEdit = !!user && (user.isAdmin || user.roles.includes('HR'));

  const [branchId, setBranchId] = useState<number | null>(user?.branchId ?? null);
  const [ym, setYm] = useState(todayYm);
  const [brush, setBrush] = useState<Brush>('PRESENT');
  /** Unsaved edits: cellKey → status (null = clear). Only differences from the saved value are kept. */
  const [edits, setEdits] = useState<Map<string, AttendanceStatus | null>>(new Map());
  const [errors, setErrors] = useState<Map<string, string>>(new Map());
  const [notice, setNotice] = useState<{ tone: 'success' | 'danger' | 'warning'; text: string } | null>(null);
  const [importing, setImporting] = useState(false);

  const branches = useQuery({ queryKey: ['branches', 'active'], queryFn: () => hrApi.branches.list() });
  useEffect(() => {
    if (branchId === null && branches.data?.[0]) setBranchId(branches.data[0].id);
  }, [branchId, branches.data]);

  const queryKey = ['attendance', branchId, ym.year, ym.month] as const;
  const { data, isLoading, isError, error } = useQuery({
    queryKey,
    queryFn: () => hrApi.attendances.month({ branchId: branchId!, year: ym.year, month: ym.month }),
    enabled: branchId !== null,
  });

  const saved = useCallback((employeeId: number, date: string) => data?.records[employeeId]?.[date]?.status ?? null, [data]);
  const statusOf = useCallback(
    (employeeId: number, date: string) => {
      const k = cellKey(employeeId, date);
      return edits.has(k) ? edits.get(k)! : saved(employeeId, date);
    },
    [edits, saved],
  );

  const dirty = edits.size > 0;
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  /** Run `fn` only if there are no unsaved edits, or the user agrees to drop them. */
  const guard = (fn: () => void) => {
    if (dirty && !window.confirm(`Discard ${edits.size} unsaved change(s)?`)) return;
    setEdits(new Map());
    setErrors(new Map());
    setNotice(null);
    fn();
  };

  const apply = (cells: Cell[], value: Brush) => {
    if (!data) return;
    const empById = new Map(data.employees.map((e) => [e.id, e]));
    const dayByDate = new Map(data.days.map((d) => [d.date, d]));
    const ok = cells.filter((c) => {
      const emp = empById.get(c.employeeId);
      const day = dayByDate.get(c.date);
      return !!emp && !!day && !blockReason(emp, day, value, data.today);
    });
    const skipped = cells.length - ok.length;
    if (ok.length === 0 && cells.length === 1) {
      const c = cells[0]!;
      const emp = empById.get(c.employeeId);
      const day = dayByDate.get(c.date);
      if (emp && day) setNotice({ tone: 'warning', text: `${emp.employee_code} on ${c.date}: ${blockReason(emp, day, value, data.today)}.` });
      return;
    }
    setEdits((prev) => {
      const next = new Map(prev);
      for (const c of ok) {
        const k = cellKey(c.employeeId, c.date);
        if (saved(c.employeeId, c.date) === value) next.delete(k);
        else next.set(k, value);
      }
      return next;
    });
    if (cells.length > 1 && skipped > 0) setNotice({ tone: 'warning', text: `${skipped} cell(s) skipped — outside service, locked, or a future date.` });
    setErrors((prev) => {
      if (prev.size === 0) return prev;
      const next = new Map(prev);
      for (const c of cells) next.delete(cellKey(c.employeeId, c.date));
      return next;
    });
  };

  /** Every blank, non-Sunday day up to today (optionally for one employee) → Present. */
  const fillPresent = (employeeId?: number) => {
    if (!data) return;
    const cells: Cell[] = [];
    for (const e of data.employees) {
      if (employeeId && e.id !== employeeId) continue;
      for (const d of data.days) {
        if (isSunday(d) || d.date > data.today || statusOf(e.id, d.date)) continue;
        if (blockReason(e, d, 'PRESENT', data.today)) continue;
        cells.push({ employeeId: e.id, date: d.date });
      }
    }
    if (cells.length === 0) { setNotice({ tone: 'warning', text: 'No blank working days to fill.' }); return; }
    apply(cells, 'PRESENT');
    setNotice({ tone: 'success', text: `${cells.length} day(s) marked Present — review and save.` });
  };

  const save = useMutation({
    mutationFn: () => {
      const entries: AttendanceEntry[] = [...edits].map(([k, status]) => {
        const [id, date] = k.split('|') as [string, string];
        return { employeeId: Number(id), date, status };
      });
      return hrApi.attendances.save({ branchId: branchId!, entries });
    },
    onSuccess: (r) => {
      setEdits(new Map());
      setErrors(new Map());
      setNotice({ tone: 'success', text: `Saved ${r.saved} day(s)${r.cleared ? `, cleared ${r.cleared}` : ''}.` });
      void qc.invalidateQueries({ queryKey: ['attendance'] });
    },
    onError: (e) => {
      const details = (e as { response?: { data?: { error?: { details?: { errors?: Array<{ employeeId: number; date: string; message: string }> } } } } })
        .response?.data?.error?.details?.errors;
      if (details) setErrors(new Map(details.map((d) => [cellKey(d.employeeId, d.date), d.message])));
      setNotice({ tone: 'danger', text: errorMessage(e) });
    },
  });

  const shiftMonth = (delta: number) =>
    guard(() => setYm(({ year, month }) => {
      const m = month + delta;
      return m < 1 ? { year: year - 1, month: 12 } : m > 12 ? { year: year + 1, month: 1 } : { year, month: m };
    }));

  /** Pre-filled month sheet (includes unsaved edits, so what you see is what you get). */
  const downloadSheet = () => {
    if (!data) return;
    const ym = `${data.year}-${String(data.month).padStart(2, '0')}`;
    downloadText(`attendance-${data.branch.code}-${ym}.csv`, toCsv(buildSheet(data.days, data.employees, statusOf)));
  };

  const summary = useMemo(() => {
    if (!data) return null;
    let marked = 0;
    for (const e of data.employees) for (const d of data.days) if (statusOf(e.id, d.date)) marked++;
    return { employees: data.employees.length, marked };
  }, [data, statusOf]);

  return (
    <>
      <PageHeader
        title="Attendance"
        subtitle="Daily attendance by branch and month · click or drag to mark days, click a date to mark the whole column"
        actions={
          <>
            <Button
              variant="secondary"
              disabled={!data || data.employees.length === 0}
              title="One row per employee, one column per day, with saved marks filled in"
              onClick={downloadSheet}
            >
              <FileDown size={16} /> Download sheet
            </Button>
            {canEdit && (
              <>
                <Button variant="secondary" disabled={!data} onClick={() => setImporting(true)}><FileUp size={16} /> Upload sheet</Button>
                <Button variant="secondary" disabled={!dirty || save.isPending} onClick={() => guard(() => undefined)}><Undo2 size={16} /> Discard</Button>
                <Button disabled={!dirty || save.isPending} onClick={() => save.mutate()}>
                  <Save size={16} /> {save.isPending ? 'Saving…' : `Save changes${dirty ? ` (${edits.size})` : ''}`}
                </Button>
              </>
            )}
          </>
        }
      />

      <div className="card mb-4 flex flex-wrap items-end gap-4 p-4">
        <div>
          <label htmlFor="att-branch" className="field-label">Branch</label>
          <select
            id="att-branch"
            className="field-input min-w-56"
            value={branchId ?? ''}
            onChange={(e) => { const v = Number(e.target.value); guard(() => setBranchId(v)); }}
          >
            {branches.data?.map((b) => <option key={b.id} value={b.id}>{b.code} — {b.name}</option>)}
          </select>
        </div>
        <div>
          <span className="field-label">Month</span>
          <div className="flex items-center gap-1">
            <Button variant="secondary" className="px-2" aria-label="Previous month" onClick={() => shiftMonth(-1)}><ChevronLeft size={16} /></Button>
            <input
              type="month"
              aria-label="Month"
              className="field-input w-44"
              value={`${ym.year}-${String(ym.month).padStart(2, '0')}`}
              onChange={(e) => {
                const [y, m] = e.target.value.split('-').map(Number);
                if (y && m) guard(() => setYm({ year: y, month: m }));
              }}
            />
            <Button variant="secondary" className="px-2" aria-label="Next month" onClick={() => shiftMonth(1)}><ChevronRight size={16} /></Button>
          </div>
        </div>

        {canEdit && (
          <div>
            <span className="field-label">Brush</span>
            <div role="radiogroup" aria-label="Status to apply" className="flex flex-wrap gap-1">
              {STATUS_ORDER.map((s) => (
                <button
                  key={s}
                  type="button"
                  role="radio"
                  aria-checked={brush === s}
                  onClick={() => setBrush(s)}
                  className={clsx(
                    'inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-sm font-medium',
                    brush === s ? 'border-transparent ring-2 ring-brand-400' : 'border-ink-200 hover:bg-ink-50',
                  )}
                >
                  <span className={clsx('inline-flex h-5 w-5 items-center justify-center rounded text-xs font-bold', STATUS[s].chip)}>{STATUS[s].code}</span>
                  {STATUS[s].label}
                </button>
              ))}
              <button
                type="button"
                role="radio"
                aria-checked={brush === null}
                onClick={() => setBrush(null)}
                className={clsx(
                  'inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-sm font-medium',
                  brush === null ? 'border-transparent ring-2 ring-brand-400' : 'border-ink-200 hover:bg-ink-50',
                )}
              >
                <Eraser size={16} className="text-ink-500" /> Clear
              </button>
            </div>
          </div>
        )}

        {canEdit && (
          <Button variant="secondary" className="ml-auto" disabled={!data || !!data.lockedReason} onClick={() => fillPresent()}>
            <CalendarCheck size={16} /> Fill blanks as Present
          </Button>
        )}
      </div>

      {data?.lockedReason && (
        <p className="mb-3 flex items-center gap-2 rounded-lg bg-warning-50 px-3 py-2 text-sm text-warning-700">
          <Lock size={14} /> {data.lockedReason}. Locked days cannot be changed.
        </p>
      )}
      {notice && (
        <p
          role={notice.tone === 'danger' ? 'alert' : 'status'}
          className={clsx(
            'mb-3 rounded-lg px-3 py-2 text-sm',
            notice.tone === 'success' && 'bg-success-50 text-success-700',
            notice.tone === 'warning' && 'bg-warning-50 text-warning-700',
            notice.tone === 'danger' && 'bg-danger-50 text-danger-700',
          )}
        >
          {notice.text}
        </p>
      )}

      {data && summary && (
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-sm text-ink-600">
          <span>
            <strong className="text-ink-900">{data.branch.name}</strong> · {MONTHS[data.month - 1]} {data.year} · {summary.employees} employee(s) · {summary.marked} day(s) marked
            {!canEdit && <span className="ml-2 text-ink-400">(read-only)</span>}
          </span>
          <span className="flex flex-wrap items-center gap-3 text-xs text-ink-500">
            {STATUS_ORDER.map((s) => (
              <span key={s} className="inline-flex items-center gap-1">
                <span className={clsx('inline-flex h-4 w-4 items-center justify-center rounded text-[10px] font-bold', STATUS[s].cell)}>{STATUS[s].code}</span>
                {STATUS[s].label}
              </span>
            ))}
            <span className="inline-flex items-center gap-1">
              <span className="h-4 w-4 rounded bg-[repeating-linear-gradient(45deg,theme(colors.ink.200)_0_3px,transparent_3px_6px)]" /> Not in service
            </span>
          </span>
        </div>
      )}

      {isLoading || branchId === null ? (
        <div className="card px-4 py-10 text-center text-sm text-ink-400">Loading…</div>
      ) : isError ? (
        <p role="alert" className="rounded-lg bg-danger-50 px-3 py-2 text-sm text-danger-700">{errorMessage(error)}</p>
      ) : data ? (
        <AttendanceGrid
          data={data}
          statusOf={statusOf}
          edited={new Set(edits.keys())}
          errors={errors}
          canEdit={canEdit}
          onPaint={(cells) => apply(cells, brush)}
          onFillRow={(id) => fillPresent(id)}
        />
      ) : null}

      {importing && data && (
        <AttendanceImport
          year={data.year}
          month={data.month}
          branchName={data.branch.name}
          onDownloadSheet={downloadSheet}
          onClose={() => setImporting(false)}
          onImported={(n) => {
            setImporting(false);
            setNotice({ tone: 'success', text: `Imported ${n} attendance row(s).` });
            void qc.invalidateQueries({ queryKey: ['attendance'] });
          }}
        />
      )}
    </>
  );
}
