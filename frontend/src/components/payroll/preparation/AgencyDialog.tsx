import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { memo, useCallback, useMemo, useState } from 'react';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Field } from '@/components/ui/Field';
import { Modal } from '@/components/ui/Modal';
import { Select } from '@/components/ui/Select';
import { MONTHS } from '@/lib/format';
import { writeSheet, type Cell, type SheetFormat } from '@/lib/spreadsheet';
import { errorMessage } from '@/services/api';
import { payrollApi } from '@/services/payroll';
import type { DeductionSheetImport, PeriodDeductionRow, PeriodDeductions } from '@/types/api';
import { findHeader, SheetUpload } from './SheetUpload';
import { amount, ConfirmBar, ErrorText, mayClose, overwriteQuestion } from './shared';

interface Draft { amount: string; remarks: string }
const show = (v: string | null) => (v === null ? '' : String(Number(v)));
const draftOf = (r: PeriodDeductionRow): Draft => ({ amount: show(r.amount), remarks: r.remarks });
const isMoney = (v: string) => /^(\d+(\.\d{1,2})?)?$/.test(v.trim());
const keyOf = (r: PeriodDeductionRow) => `${r.employeeId}|${r.componentId}`;

interface Props { periodId: number; periodLabel: string; fileLabel: string; onClose: () => void; onSaved: (message: string) => void }

export function AgencyDialog({ periodId, periodLabel, fileLabel, onClose, onSaved }: Props) {
  const qc = useQueryClient();
  const key = ['period-deductions', periodId];
  const q = useQuery({ queryKey: key, queryFn: () => payrollApi.periodDeductions.get(periodId), refetchOnWindowFocus: false });
  const d = q.data;
  const [chosen, setChosen] = useState('');
  const [filter, setFilter] = useState('');
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [question, setQuestion] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const componentId = Number(chosen || d?.components[0]?.id || 0);
  const component = d?.components.find((c) => c.id === componentId);

  const change = useCallback((r: PeriodDeductionRow, patch: Partial<Draft>) => setDrafts((all) => ({ ...all, [keyOf(r)]: { ...(all[keyOf(r)] ?? draftOf(r)), ...patch } })), []);
  // Only changed rows are sent; every other row keeps following its assignment.
  const changed = useMemo(
    () => (d?.rows ?? []).filter((r) => {
      const x = drafts[keyOf(r)];
      return x && (x.amount.trim() === '' ? r.amount !== null || x.remarks.trim() !== r.remarks : r.amount === null || Number(x.amount) !== Number(r.amount) || x.remarks.trim() !== r.remarks);
    }),
    [d, drafts],
  );
  const invalid = changed.filter((r) => !isMoney(drafts[keyOf(r)]!.amount));

  const save = useMutation({
    mutationFn: (confirm: boolean) =>
      payrollApi.periodDeductions.save(periodId, {
        confirm,
        entries: changed.map((r) => {
          const x = drafts[keyOf(r)]!;
          const blank = x.amount.trim() === '';
          // Clearing an amount removes the entry, and its remarks with it.
          return { employeeId: r.employeeId, componentId: r.componentId, amount: blank ? null : Number(x.amount), remarks: blank && r.amount !== null ? '' : x.remarks };
        }),
      }),
    onSuccess: (r) => done(`Agency deductions saved: ${r.saved} amount(s) saved, ${r.removed} removed.`),
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
  const rows = (d?.rows ?? []).filter((r) => r.componentId === componentId && (!term || [r.employeeCode, r.employeeName, r.branch].some((v) => v.toLowerCase().includes(term))));
  const close = () => mayClose(changed.length > 0) && onClose();

  return (
    <Modal open size="xl" title={`Agency deductions · ${periodLabel}`} onClose={close}>
      <div className="space-y-4">
        <p className="text-sm text-ink-600">The amount replaces the assigned amount for this month only. Leave it blank to deduct the assigned amount; enter 0 to deduct nothing this month.</p>
        {q.isError && <ErrorText>{errorMessage(q.error)}</ErrorText>}
        {d && d.components.length === 0 && <p className="text-sm text-ink-600">No employee has a fixed deduction assigned for this month.</p>}
        {d && component && (
          <>
            <div className="grid gap-3 sm:grid-cols-2 lg:max-w-2xl">
              <Select label="Deduction" name="component" placeholder="Select deduction" value={componentId} onChange={(e) => setChosen(e.target.value)} options={d.components.map((c) => ({ value: c.id, label: `${c.code} — ${c.name}` }))} />
              <Field label="Find" name="find" placeholder="Code, name or branch" value={filter} onChange={(e) => setFilter(e.target.value)} />
            </div>
            {d.editable && (
              <SheetUpload<DeductionSheetImport>
                key={componentId}
                onDownload={(f) => download(d, component, fileLabel, f)}
                prepare={(table) => {
                  const { period, ...body } = sheetToImport(table);
                  return {
                    send: (o) => payrollApi.periodDeductions.import(periodId, { componentId, ...body, ...o }),
                    note: period && period !== templatePeriod(d) ? `This sheet was made for ${period}. Check that the amounts are for ${templatePeriod(d)}.` : undefined,
                  };
                }}
                columns={[
                  { header: 'Assigned', cell: (r) => (r.assigned === null ? '' : amount(r.assigned)) },
                  { header: 'Saved', cell: (r) => (r.previous === null ? '—' : amount(r.previous)) },
                  { header: 'New', cell: (r) => (r.error ? '' : r.amount === null ? 'Assigned amount' : r.waived ? '0 (waived)' : amount(r.amount)) },
                ]}
                onSaved={(r) => done(`${component.code} uploaded: ${r.imported} row(s) saved${r.errors ? `, ${r.errors} with errors left out` : ''}.`)}
              />
            )}
            <div className="max-h-[45vh] overflow-auto rounded-lg border border-ink-200">
              <table className="min-w-full text-sm">
                <thead className="sticky top-0 z-10 bg-ink-50 text-left text-xs font-semibold uppercase tracking-wide text-ink-500">
                  <tr>{['Branch', 'Code', 'Employee', 'Component', 'Default', 'Amount', '', 'Remarks'].map((h, n) => <th key={n} className={`px-2 py-2 ${h === 'Default' ? 'text-right' : ''}`}>{h}</th>)}</tr>
                </thead>
                <tbody className="divide-y divide-ink-100">
                  {rows.length === 0 && <tr><td colSpan={8} className="px-3 py-6 text-center text-ink-400">No employees</td></tr>}
                  {rows.map((r) => <DeductionRow key={keyOf(r)} row={r} draft={drafts[keyOf(r)]} editable={d.editable} onChange={change} />)}
                </tbody>
              </table>
            </div>
          </>
        )}
        {notice && changed.length === 0 && <p role="status" className="rounded-lg bg-success-50 px-3 py-2 text-sm text-success-700">{notice}</p>}
        {invalid.length > 0 && <ErrorText>Enter an amount with at most 2 decimal places: {invalid.map((r) => `${r.employeeCode} ${r.componentCode}`).join(', ')}</ErrorText>}
        {save.isError && !question && <ErrorText>{errorMessage(save.error)}</ErrorText>}
        {question && <ConfirmBar message={question} action="Yes, replace" busy={save.isPending} onNo={() => { setQuestion(null); save.reset(); }} onYes={() => save.mutate(true)} />}
        <div className="flex items-center justify-end gap-2">
          <span className="mr-auto text-sm text-ink-500">{changed.length ? `${changed.length} amount(s) changed` : ''}</span>
          <Button variant="secondary" onClick={close}>Close</Button>
          {d?.editable && component && <Button disabled={changed.length === 0 || invalid.length > 0 || save.isPending || !!question} onClick={() => save.mutate(false)}>{save.isPending ? 'Saving…' : 'Save'}</Button>}
        </div>
      </div>
    </Modal>
  );
}

interface RowProps { row: PeriodDeductionRow; draft: Draft | undefined; editable: boolean; onChange: (r: PeriodDeductionRow, patch: Partial<Draft>) => void }
const DeductionRow = memo(function DeductionRow({ row, draft, editable, onChange }: RowProps) {
  const x = draft ?? draftOf(row);
  return (
    <tr className={draft ? 'bg-brand-25' : undefined}>
      <td className="whitespace-nowrap px-2 py-1">{row.branch}</td>
      <td className="whitespace-nowrap px-2 py-1">{row.employeeCode}</td>
      <td className="whitespace-nowrap px-2 py-1 font-medium">{row.employeeName}</td>
      <td className="whitespace-nowrap px-2 py-1">{row.componentCode}</td>
      <td className="px-2 py-1 text-right tabular-nums">{amount(row.assigned)}</td>
      <td className="px-1 py-1">
        <input
          aria-label={`Amount for ${row.employeeCode}`} inputMode="decimal" disabled={!editable} value={x.amount} aria-invalid={!isMoney(x.amount)}
          className="field-input w-28 px-2 py-1 text-right tabular-nums aria-[invalid=true]:border-danger-500" onChange={(e) => onChange(row, { amount: e.target.value })}
        />
      </td>
      <td className="px-1 py-1">{x.amount.trim() !== '' && Number(x.amount) === 0 && <Badge tone="warning">Waived</Badge>}</td>
      <td className="px-1 py-1">
        <input aria-label={`Remarks for ${row.employeeCode}`} maxLength={500} disabled={!editable} value={x.remarks} className="field-input min-w-[10rem] px-2 py-1" onChange={(e) => onChange(row, { remarks: e.target.value })} />
      </td>
    </tr>
  );
});

const templatePeriod = (d: PeriodDeductions) => `${MONTHS[d.period.month - 1]} ${d.period.calendarYear}`;

function download(d: PeriodDeductions, c: { id: number; code: string; name: string }, fileLabel: string, format: SheetFormat) {
  // Last month's amount is filled in, but never 0: a 0 waives the deduction.
  const start = (r: PeriodDeductionRow) => (r.amount !== null ? Number(r.amount) : Number(r.previous ?? 0) > 0 ? Number(r.previous) : null);
  const rows: Cell[][] = [
    ['Deduction code', c.code],
    ['Deduction name', c.name],
    ['Period', templatePeriod(d)],
    ['Generated', new Date().toLocaleString('en-IN')],
    ['Amount', 'Blank = the default amount; 0 = nothing this month'],
    [],
    ['EmployeeCode', 'EmployeeName', 'Default', 'Amount'],
    ...d.rows.filter((r) => r.componentId === c.id).map((r) => [r.employeeCode, r.employeeName, Number(r.assigned), start(r)]),
  ];
  void writeSheet(`deduction-${c.code.replace(/\W+/g, '-')}-${fileLabel}`, rows, format);
}

function sheetToImport(table: string[][]) {
  const h = findHeader(table, ['EmployeeCode', 'Amount']);
  const code = h.col('EmployeeCode');
  const col = h.col('Amount');
  const meta = (name: string) => table.slice(0, h.row).find((r) => (r[0] ?? '').trim().toLowerCase() === name)?.[1]?.trim() || null;
  return {
    sheetCode: meta('deduction code'),
    period: meta('period'),
    rows: table.flatMap((r, n) => (n <= h.row || r.every((c) => c.trim() === '') ? [] : [{ line: n + 1, code: r[code] ?? '', amount: r[col] ?? '' }])),
  };
}
