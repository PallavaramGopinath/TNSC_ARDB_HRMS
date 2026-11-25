import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Fragment, memo, useCallback, useMemo, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Field } from '@/components/ui/Field';
import { Modal } from '@/components/ui/Modal';
import { writeSheet, type Cell, type SheetFormat } from '@/lib/spreadsheet';
import { errorMessage } from '@/services/api';
import { payrollApi } from '@/services/payroll';
import type { AttendanceSheetImport, PeriodAttendance, PeriodAttendanceRow } from '@/types/api';
import { findHeader, SheetUpload } from './SheetUpload';
import { ConfirmBar, ErrorText, mayClose, overwriteQuestion } from './shared';

/** Typed text of one row; a blank is 0. */
interface Draft { hq: string; camp: string; remarks: string; leaves: Record<number, string> }
const show = (n: number | undefined) => (n ? String(n) : '');
const draftOf = (r: PeriodAttendanceRow): Draft => ({
  hq: show(r.headQuarters), camp: show(r.camp), remarks: r.remarks, leaves: Object.fromEntries(Object.entries(r.leaves).map(([k, v]) => [k, show(v)])),
});
const isDays = (v: string) => /^\d{0,2}$/.test(v.trim());
const num = (v: string | undefined) => Number((v ?? '').trim() || 0);

interface Props { periodId: number; periodLabel: string; fileLabel: string; onClose: () => void; onSaved: (message: string) => void }

export function AttendanceDialog({ periodId, periodLabel, fileLabel, onClose, onSaved }: Props) {
  const qc = useQueryClient();
  const key = ['period-attendance', periodId];
  const q = useQuery({ queryKey: key, queryFn: () => payrollApi.periodAttendance.get(periodId), refetchOnWindowFocus: false });
  const [drafts, setDrafts] = useState<Record<number, Draft>>({});
  const [filter, setFilter] = useState('');
  const [question, setQuestion] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const d = q.data;

  const change = useCallback((row: PeriodAttendanceRow, patch: (x: Draft) => Draft) => setDrafts((all) => ({ ...all, [row.employeeId]: patch(all[row.employeeId] ?? draftOf(row)) })), []);
  const types = d?.leaveTypes ?? [];
  const changed = useMemo(() => {
    const same = (r: PeriodAttendanceRow, x: Draft) =>
      num(x.hq) === r.headQuarters && num(x.camp) === r.camp && x.remarks.trim() === r.remarks && types.every((t) => num(x.leaves[t.id]) === (r.leaves[t.id] ?? 0));
    return (d?.rows ?? []).filter((r) => drafts[r.employeeId] && !same(r, drafts[r.employeeId]!));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [d, drafts]);
  const invalid = changed.filter((r) => {
    const x = drafts[r.employeeId]!;
    return ![x.hq, x.camp, ...Object.values(x.leaves)].every(isDays);
  });

  const save = useMutation({
    mutationFn: (confirm: boolean) =>
      payrollApi.periodAttendance.save(periodId, {
        confirm,
        entries: changed.map((r) => {
          const x = drafts[r.employeeId]!;
          return {
            employeeId: r.employeeId, headQuarters: num(x.hq), camp: num(x.camp), remarks: x.remarks,
            leaves: types.map((t) => ({ leaveTypeId: t.id, days: num(x.leaves[t.id]) })).filter((l) => l.days > 0),
          };
        }),
      }),
    onSuccess: (r) => done(`Attendance saved: ${r.saved} row(s) saved, ${r.removed} deleted.`),
    onError: (e) => setQuestion(overwriteQuestion(e)),
  });
  const done = (message: string) => {
    setDrafts({});
    setQuestion(null);
    setNotice(message);
    void qc.invalidateQueries({ queryKey: key });
    onSaved(message);
  };

  const term = filter.trim().toLowerCase();
  const rows = (d?.rows ?? []).filter((r) => !term || [r.employeeCode, r.employeeName, r.branch].some((v) => v.toLowerCase().includes(term)));
  const close = () => mayClose(changed.length > 0) && onClose();

  return (
    <Modal open size="xl" title={`Monthly attendance · ${periodLabel}`} onClose={close}>
      <div className="space-y-4">
        <p className="text-sm text-ink-600">Enter whole days. Present days are not entered: an employee with no entry is paid in full. HQ and Camp do not affect pay. Leave balances are not changed here.</p>
        {q.isError && <ErrorText>{errorMessage(q.error)}</ErrorText>}
        {d?.editable && (
          <SheetUpload<AttendanceSheetImport>
            onDownload={(f) => download(d, fileLabel, f)}
            prepare={(table) => ({ send: (o) => payrollApi.periodAttendance.import(periodId, { ...sheetToImport(table), ...o }) })}
            columns={[]}
            onSaved={(r) => done(`Attendance uploaded: ${r.imported} row(s) saved${r.errors ? `, ${r.errors} with errors left out` : ''}.`)}
          />
        )}
        <div className="max-w-xs"><Field label="Find" name="find" placeholder="Code, name or branch" value={filter} onChange={(e) => setFilter(e.target.value)} /></div>
        <div className="max-h-[50vh] overflow-auto rounded-lg border border-ink-200">
          <table className="min-w-full text-sm">
            <thead className="sticky top-0 z-10 bg-ink-50 text-left text-xs font-semibold uppercase tracking-wide text-ink-500">
              <tr>
                {['Branch', 'Code', 'Employee', 'HQ', 'Camp'].map((h) => <th key={h} className="px-2 py-2">{h}</th>)}
                {types.map((t) => (
                  <th key={t.id} className="px-2 py-2" title={`${t.name}: ${Number(t.payCutFactor) === 0 ? 'full pay' : `${Number(t.payCutFactor)} day's pay cut for each day`}${t.cutsSpecialPayAndDa ? ', also from SP and DA' : ''}`}>{t.code}</th>
                ))}
                <th className="px-2 py-2">Remarks</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-ink-100">
              {q.isLoading && <tr><td colSpan={6 + types.length} className="px-3 py-6 text-center text-ink-400">Loading…</td></tr>}
              {d && rows.length === 0 && <tr><td colSpan={6 + types.length} className="px-3 py-6 text-center text-ink-400">No employees</td></tr>}
              {d && rows.map((r) => <AttendanceRow key={r.employeeId} row={r} draft={drafts[r.employeeId]} types={d.leaveTypes} editable={d.editable} onChange={change} />)}
            </tbody>
          </table>
        </div>
        {notice && changed.length === 0 && <p role="status" className="rounded-lg bg-success-50 px-3 py-2 text-sm text-success-700">{notice}</p>}
        {invalid.length > 0 && <ErrorText>Enter whole days only: {invalid.map((r) => r.employeeCode).join(', ')}</ErrorText>}
        {save.isError && !question && <ErrorText>{errorMessage(save.error)}</ErrorText>}
        {question && <ConfirmBar message={question} action="Yes, replace" busy={save.isPending} onNo={() => { setQuestion(null); save.reset(); }} onYes={() => save.mutate(true)} />}
        <div className="flex items-center justify-end gap-2">
          <span className="mr-auto text-sm text-ink-500">{changed.length ? `${changed.length} row(s) changed` : ''}</span>
          <Button variant="secondary" onClick={close}>Close</Button>
          {d?.editable && <Button disabled={changed.length === 0 || invalid.length > 0 || save.isPending || !!question} onClick={() => save.mutate(false)}>{save.isPending ? 'Saving…' : 'Save'}</Button>}
        </div>
      </div>
    </Modal>
  );
}

interface RowProps {
  row: PeriodAttendanceRow;
  draft: Draft | undefined;
  types: PeriodAttendance['leaveTypes'];
  editable: boolean;
  onChange: (row: PeriodAttendanceRow, patch: (x: Draft) => Draft) => void;
}
const AttendanceRow = memo(function AttendanceRow({ row, draft, types, editable, onChange }: RowProps) {
  const x = draft ?? draftOf(row);
  const days = (label: string, value: string, set: (v: string) => (d: Draft) => Draft) => (
    <td className="px-1 py-1">
      <input
        aria-label={`${label} for ${row.employeeCode}`} inputMode="numeric" disabled={!editable} value={value} aria-invalid={!isDays(value)}
        className="field-input w-14 px-2 py-1 text-right tabular-nums aria-[invalid=true]:border-danger-500" onChange={(e) => onChange(row, set(e.target.value))}
      />
    </td>
  );
  return (
    <tr className={draft ? 'bg-brand-25' : undefined}>
      <td className="whitespace-nowrap px-2 py-1">{row.branch}</td>
      <td className="whitespace-nowrap px-2 py-1">{row.employeeCode}</td>
      <td className="whitespace-nowrap px-2 py-1 font-medium">{row.employeeName}</td>
      {days('HQ', x.hq, (v) => (d) => ({ ...d, hq: v }))}
      {days('Camp', x.camp, (v) => (d) => ({ ...d, camp: v }))}
      {types.map((t) => <Fragment key={t.id}>{days(t.code, x.leaves[t.id] ?? '', (v) => (d) => ({ ...d, leaves: { ...d.leaves, [t.id]: v } }))}</Fragment>)}
      <td className="px-1 py-1">
        <input aria-label={`Remarks for ${row.employeeCode}`} maxLength={500} disabled={!editable} value={x.remarks} className="field-input min-w-[10rem] px-2 py-1" onChange={(e) => onChange(row, (d) => ({ ...d, remarks: e.target.value }))} />
      </td>
    </tr>
  );
});

function download(d: PeriodAttendance, fileLabel: string, format: SheetFormat) {
  const rows: Cell[][] = [
    ['EmployeeCode', 'EmployeeName', 'HQ', 'Camp', ...d.leaveTypes.map((t) => t.code)],
    // Saved days are filled in, so that uploading the sheet again does not clear them.
    ...d.rows.map((r) => [r.employeeCode, r.employeeName, r.headQuarters || null, r.camp || null, ...d.leaveTypes.map((t) => r.leaves[t.id] || null)]),
  ];
  void writeSheet(`payroll-attendance-${fileLabel}`, rows, format);
}

function sheetToImport(table: string[][]) {
  const h = findHeader(table, ['EmployeeCode']);
  const code = h.col('EmployeeCode');
  const cols = h.header.flatMap((c, n) => (n !== code && c.trim() !== '' && !h.is(c, 'EmployeeName') ? [n] : []));
  return {
    headers: cols.map((n) => h.header[n]!.trim()),
    rows: table.flatMap((r, n) => (n <= h.row || r.every((c) => c.trim() === '') ? [] : [{ line: n + 1, code: r[code] ?? '', values: cols.map((c) => r[c] ?? '') }])),
  };
}
