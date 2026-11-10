import { useMutation } from '@tanstack/react-query';
import { CheckCircle2, Download, FileWarning } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { downloadText, parseCsv } from '@/lib/csv';
import { errorMessage } from '@/services/api';
import { hrApi } from '@/services/hr';
import type { AttendanceImportResult, AttendanceImportRow } from '@/types/api';

const TEMPLATE = 'code,date,status\nEMP001,2026-11-03,P\nEMP002,03-11-2026,A\nEMP003,2026-11-03,HD\n';
const MAX_ROWS = 5000;

/** CSV rows → import rows. A first row containing "code" is treated as the header. Blank lines are skipped. */
function toRows(text: string): { rows: AttendanceImportRow[]; problem: string | null } {
  const table = parseCsv(text);
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

/** Upload code,date,status CSV → server dry run → import when every row is valid (all or nothing). */
export function AttendanceImport({ onClose, onImported }: { onClose: () => void; onImported: (n: number) => void }) {
  const [fileName, setFileName] = useState<string | null>(null);
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
    if (!f) return;
    setFileName(f.name);
    const { rows: parsed, problem } = toRows(await f.text());
    if (problem) { setErr(problem); return; }
    setRows(parsed);
    dryRun.mutate(parsed);
  };

  const ready = !!check && check.errors.length === 0 && check.valid > 0;

  return (
    <Modal open title="Import attendance (CSV)" onClose={onClose}>
      <div className="space-y-4 text-sm">
        <p className="text-ink-600">
          Columns <code className="rounded bg-ink-100 px-1">code,date,status</code>. Dates as YYYY-MM-DD or DD-MM-YYYY; status P, A, L, H or HD.
          Existing marks for the same employee and day are overwritten. Nothing is imported unless every row is valid.
        </p>
        <button type="button" onClick={() => downloadText('attendance-template.csv', TEMPLATE)} className="inline-flex items-center gap-1 text-brand-700 hover:underline">
          <Download size={14} /> Download template
        </button>

        <div>
          <label htmlFor="att-csv" className="field-label">CSV file</label>
          <input id="att-csv" type="file" accept=".csv,text/csv" className="field-input" onChange={(e) => void onFile(e.target.files?.[0])} />
        </div>

        {dryRun.isPending && <p className="text-ink-500">Checking {rows.length} row(s)…</p>}
        {err && <p role="alert" className="rounded-lg bg-danger-50 px-3 py-2 text-danger-700">{err}</p>}

        {check && (
          check.errors.length === 0 ? (
            <p className="flex items-center gap-2 rounded-lg bg-success-50 px-3 py-2 text-success-700">
              <CheckCircle2 size={16} /> {fileName}: all {check.valid} row(s) are valid.
            </p>
          ) : (
            <div className="space-y-2">
              <p className="flex items-center gap-2 rounded-lg bg-danger-50 px-3 py-2 text-danger-700">
                <FileWarning size={16} /> {check.errors.length} of {check.total} row(s) have problems. Fix the file and choose it again.
              </p>
              <div className="max-h-64 overflow-y-auto rounded-lg border border-ink-200">
                <table className="min-w-full text-xs">
                  <thead className="sticky top-0 bg-ink-50 text-left font-semibold uppercase tracking-wide text-ink-500">
                    <tr><th className="px-2 py-1.5">Line</th><th className="px-2 py-1.5">Code</th><th className="px-2 py-1.5">Date</th><th className="px-2 py-1.5">Problem</th></tr>
                  </thead>
                  <tbody className="divide-y divide-ink-100">
                    {check.errors.map((e) => (
                      <tr key={e.line}>
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
            {commit.isPending ? 'Importing…' : ready ? `Import ${check.valid} row(s)` : 'Import'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
