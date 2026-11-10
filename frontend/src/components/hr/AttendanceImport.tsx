import { useMutation } from '@tanstack/react-query';
import { CheckCircle2, Download, FileSpreadsheet, FileWarning } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { MONTHS } from '@/lib/format';
import { downloadText, parseCsv, toCsv } from '@/lib/csv';
import { errorMessage } from '@/services/api';
import { hrApi } from '@/services/hr';
import type { AttendanceImportResult, AttendanceImportRow } from '@/types/api';
import { isMonthSheet, sheetToRows } from './attendanceSheet';

const LIST_TEMPLATE = [['code', 'date', 'status'], ['EMP001', '2026-11-03', 'P'], ['EMP002', '03-11-2026', 'A'], ['EMP003', '2026-11-03', 'HD']];
const MAX_ROWS = 5000;

type Format = 'sheet' | 'list';

/**
 * CSV → import rows. Two layouts are accepted:
 * - month sheet (Code, Name, …, one column per day) — dates come from the month on screen;
 * - list (code,date,status), with or without a header row.
 */
function toRows(text: string, year: number, month: number): { rows: AttendanceImportRow[]; problem: string | null; format: Format } {
  const table = parseCsv(text);
  const sheet = !!table[0] && isMonthSheet(table[0]);
  const r = sheet ? sheetToRows(table, year, month) : listToRows(table);
  const format: Format = sheet ? 'sheet' : 'list';
  if (!r.problem && r.rows.length > MAX_ROWS)
    return { rows: [], problem: `The file has ${r.rows.length} marks; import at most ${MAX_ROWS} at a time`, format };
  return { ...r, format };
}

/** code,date,status rows. A first row containing "code" is treated as the header. Blank lines are skipped. */
function listToRows(table: string[][]): { rows: AttendanceImportRow[]; problem: string | null } {
  let start = 0;
  let idx = { code: 0, date: 1, status: 2 };
  const head = table[0]?.map((h) => h.trim().toLowerCase());
  if (head?.includes('code')) {
    idx = { code: head.indexOf('code'), date: head.indexOf('date'), status: head.indexOf('status') };
    if (idx.date < 0 || idx.status < 0) return { rows: [], problem: 'The header must have the columns code, date and status' };
    start = 1;
  }
  const rows: AttendanceImportRow[] = [];
  for (let i = start; i < table.length; i++) {
    const r = table[i]!;
    if (r.every((c) => c.trim() === '')) continue;
    rows.push({ line: i + 1, code: (r[idx.code] ?? '').trim(), date: (r[idx.date] ?? '').trim(), status: (r[idx.status] ?? '').trim() });
  }
  if (rows.length === 0) return { rows, problem: 'The file has no data rows' };
  if (rows.length > MAX_ROWS) return { rows: [], problem: `The file has ${rows.length} rows; import at most ${MAX_ROWS} at a time` };
  return { rows, problem: null };
}

interface Props {
  year: number;
  month: number;
  branchName: string;
  /** Downloads the pre-filled month sheet for the branch and month on screen. */
  onDownloadSheet: () => void;
  onClose: () => void;
  onImported: (n: number) => void;
}

/** Upload a month sheet or a code,date,status list → server dry run → import when every mark is valid (all or nothing). */
export function AttendanceImport({ year, month, branchName, onDownloadSheet, onClose, onImported }: Props) {
  const monthLabel = `${MONTHS[month - 1]} ${year}`;
  const [fileName, setFileName] = useState<string | null>(null);
  const [format, setFormat] = useState<Format | null>(null);
  const [rows, setRows] = useState<AttendanceImportRow[]>([]);
  const [check, setCheck] = useState<AttendanceImportResult | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const dryRun = useMutation({
    mutationFn: (r: AttendanceImportRow[]) => hrApi.attendances.import({ rows: r, dryRun: true }),
    onSuccess: setCheck,
    onError: (e) => setErr(errorMessage(e)),
  });
  const commit = useMutation({
    mutationFn: () => hrApi.attendances.import({ rows, dryRun: false }),
    onSuccess: (r) => (r.errors.length ? setCheck(r) : onImported(r.imported)),
    onError: (e) => setErr(errorMessage(e)),
  });

  const onFile = async (f: File | undefined) => {
    setErr(null);
    setCheck(null);
    setRows([]);
    setFormat(null);
    if (!f) return;
    setFileName(f.name);
    const { rows: parsed, problem, format: fmt } = toRows(await f.text(), year, month);
    setFormat(fmt);
    if (problem) { setErr(problem); return; }
    setRows(parsed);
    dryRun.mutate(parsed);
  };

  const ready = !!check && check.errors.length === 0 && check.valid > 0;

  return (
    <Modal open title="Upload attendance sheet" onClose={onClose}>
      <div className="space-y-4 text-sm">
        <ol className="list-decimal space-y-1 pl-5 text-ink-600">
          <li>
            <button type="button" onClick={onDownloadSheet} className="inline-flex items-center gap-1 font-semibold text-brand-700 hover:underline">
              <FileSpreadsheet size={14} /> Download the sheet for {branchName}, {monthLabel}
            </button>{' '}
            — one row per employee, one column per day, with marks already saved filled in.
          </li>
          <li>
            Fill the day columns with <b>P</b> present, <b>A</b> absent, <b>L</b> leave, <b>HD</b> half day or <b>H</b> holiday.
            Blank cells are left unchanged; <b>-</b> means not in service.
          </li>
          <li>Save as CSV and upload it below. Nothing is imported unless every mark is valid.</li>
        </ol>
        <p className="text-xs text-ink-500">
          A list with the columns <code className="rounded bg-ink-100 px-1">code,date,status</code> (any month) is also accepted —{' '}
          <button type="button" onClick={() => downloadText('attendance-list-template.csv', toCsv(LIST_TEMPLATE))} className="inline-flex items-center gap-1 text-brand-700 hover:underline">
            <Download size={12} /> list template
          </button>
          .
        </p>

        <div>
          <label htmlFor="att-csv" className="field-label">CSV file</label>
          <input id="att-csv" type="file" accept=".csv,text/csv" className="field-input" onChange={(e) => void onFile(e.target.files?.[0])} />
        </div>

        {format === 'sheet' && !err && <p className="text-ink-500">Month sheet detected — marks will be imported for <b>{monthLabel}</b>.</p>}
        {dryRun.isPending && <p className="text-ink-500">Checking {rows.length} mark(s)…</p>}
        {err && <p role="alert" className="rounded-lg bg-danger-50 px-3 py-2 text-danger-700">{err}</p>}

        {check && (
          check.errors.length === 0 ? (
            check.valid === 0 ? (
              <p className="flex items-center gap-2 rounded-lg bg-ink-100 px-3 py-2 text-ink-700">
                <CheckCircle2 size={16} /> {fileName}: nothing to import — all {check.unchanged} mark(s) are already saved.
              </p>
            ) : (
              <p className="flex items-center gap-2 rounded-lg bg-success-50 px-3 py-2 text-success-700">
                <CheckCircle2 size={16} />
                {fileName}: {check.valid} new or changed mark(s) ready to import{check.unchanged ? `; ${check.unchanged} already saved will be skipped` : ''}.
              </p>
            )
          ) : (
            <div className="space-y-2">
              <p className="flex items-center gap-2 rounded-lg bg-danger-50 px-3 py-2 text-danger-700">
                <FileWarning size={16} /> {check.errors.length} of {check.total} mark(s) have problems. Fix the file and choose it again.
              </p>
              <div className="max-h-64 overflow-y-auto rounded-lg border border-ink-200">
                <table className="min-w-full text-xs">
                  <thead className="sticky top-0 bg-ink-50 text-left font-semibold uppercase tracking-wide text-ink-500">
                    <tr><th className="px-2 py-1.5">Row</th><th className="px-2 py-1.5">Code</th><th className="px-2 py-1.5">Date</th><th className="px-2 py-1.5">Problem</th></tr>
                  </thead>
                  <tbody className="divide-y divide-ink-100">
                    {check.errors.map((e, i) => (
                      <tr key={`${e.line}-${e.date}-${i}`}>
                        <td className="px-2 py-1 tabular-nums">{e.line}</td>
                        <td className="px-2 py-1"><code>{e.code}</code></td>
                        <td className="px-2 py-1">{e.date}</td>
                        <td className="px-2 py-1 text-danger-700">{e.message}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )
        )}

        <div className="flex justify-end gap-2 border-t border-ink-200 pt-4">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button disabled={!ready || commit.isPending} onClick={() => commit.mutate()}>
            {commit.isPending ? 'Importing…' : ready ? `Import ${check.valid} mark(s)` : 'Import'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
