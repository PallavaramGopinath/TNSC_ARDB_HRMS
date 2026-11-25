import { useMutation } from '@tanstack/react-query';
import clsx from 'clsx';
import { Download, Upload } from 'lucide-react';
import { useRef, useState, type ReactNode } from 'react';
import { Button } from '@/components/ui/Button';
import { readSheet, type SheetFormat } from '@/lib/spreadsheet';
import { errorMessage } from '@/services/api';
import type { ImportResult } from '@/types/api';
import { ConfirmBar, ErrorText, overwriteQuestion } from './shared';

type Row<R extends ImportResult> = R['rows'][number];
type Send<R> = (o: { dryRun: boolean; confirm: boolean }) => Promise<R>;

interface Props<R extends ImportResult> {
  onDownload: (format: SheetFormat) => void;
  /** Reads the sheet, and returns how to send it; throws a message for the user. `note` is shown with the rows. */
  prepare: (table: string[][]) => { send: Send<R>; note?: string };
  columns: Array<{ header: string; cell: (r: Row<R>) => ReactNode }>;
  onSaved: (r: R) => void;
}

const ACTION = { NEW: 'New', OVERWRITE: 'Overwrite', REMOVE: 'Remove', UNCHANGED: 'Unchanged' } as const;

/** Choose a file → the server checks it without saving, row by row → Upload saves the valid rows. */
export function SheetUpload<R extends ImportResult>({ onDownload, prepare, columns, onSaved }: Props<R>) {
  const input = useRef<HTMLInputElement>(null);
  const [send, setSend] = useState<{ run: Send<R>; note?: string } | null>(null);
  const [view, setView] = useState<R | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [question, setQuestion] = useState<string | null>(null);

  const check = useMutation({
    mutationFn: async (file: File | undefined) => {
      const { send: run, note } = prepare(await readSheet(file));
      const result = await run({ dryRun: true, confirm: false });
      return { run, note, result };
    },
    onSuccess: (r) => { setSend({ run: r.run, note: r.note }); setView(r.result); },
    onError: (e) => setError(errorMessage(e)),
  });
  const upload = useMutation({
    mutationFn: (confirm: boolean) => send!.run({ dryRun: false, confirm }),
    onSuccess: (r) => { reset(); onSaved(r); },
    onError: (e) => { const q = overwriteQuestion(e); setQuestion(q); setError(q ? null : errorMessage(e)); },
  });
  const reset = () => {
    setSend(null); setView(null); setError(null); setQuestion(null);
    if (input.current) input.current.value = '';
  };
  const changes = view ? view.added + view.overwritten + view.removed : 0;
  const busy = check.isPending || upload.isPending;

  return (
    <div className="space-y-3 rounded-lg border border-ink-200 p-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-semibold text-ink-700">Upload</span>
        <input
          ref={input} type="file" aria-label="Sheet to upload" accept=".xlsx,.csv" disabled={busy} className="max-w-xs text-sm"
          onChange={(e) => { const f = e.target.files?.[0]; setSend(null); setView(null); setError(null); setQuestion(null); if (f) check.mutate(f); }}
        />
        <Button disabled={busy || changes === 0 || !!question} onClick={() => upload.mutate(false)}><Upload size={14} /> {upload.isPending ? 'Uploading…' : changes ? `Upload ${changes} row(s)` : 'Upload'}</Button>
        {view && <Button variant="ghost" disabled={busy} onClick={reset}>Clear</Button>}
        <span className="ml-auto flex items-center gap-2 text-ink-600">
          Template
          <Button variant="secondary" className="px-2 py-1" onClick={() => onDownload('xlsx')}><Download size={14} /> .xlsx</Button>
          <Button variant="secondary" className="px-2 py-1" onClick={() => onDownload('csv')}><Download size={14} /> .csv</Button>
        </span>
      </div>
      {check.isPending && <p className="text-ink-500">Checking the sheet…</p>}
      {error && <ErrorText>{error}</ErrorText>}
      {question && <ConfirmBar message={question} action="Yes, overwrite" busy={busy} onNo={() => setQuestion(null)} onYes={() => upload.mutate(true)} />}
      {view && (
        <>
          {send?.note && <p className="rounded-lg bg-warning-50 px-3 py-2 text-warning-700">{send.note}</p>}
          <p className="text-ink-700">
            {view.total} row(s): {view.added} new, {view.overwritten} overwrite, {view.removed} remove, {view.unchanged} unchanged
            {view.errors > 0 && <span className="font-semibold text-danger-700"> · {view.errors} with errors, which are left out</span>}
          </p>
          <div className="max-h-56 overflow-auto rounded-lg border border-ink-200">
            <table className="min-w-full text-xs">
              <thead className="sticky top-0 bg-ink-50 text-left font-semibold uppercase tracking-wide text-ink-500">
                <tr>{['Row', 'Code', 'Employee', ...columns.map((c) => c.header), 'Change', 'Check'].map((h) => <th key={h} className="px-2 py-1.5">{h}</th>)}</tr>
              </thead>
              <tbody className="divide-y divide-ink-100">
                {view.rows.map((r) => (
                  <tr key={r.line} className={clsx(r.action === 'UNCHANGED' && 'text-ink-400')}>
                    <td className="px-2 py-1 tabular-nums">{r.line}</td>
                    <td className="px-2 py-1"><code>{r.code}</code></td>
                    <td className="px-2 py-1">{r.name}</td>
                    {columns.map((c) => <td key={c.header} className="px-2 py-1 tabular-nums">{c.cell(r)}</td>)}
                    <td className="px-2 py-1">{r.action ? ACTION[r.action] : '—'}</td>
                    <td className={clsx('px-2 py-1', r.error ? 'text-danger-700' : 'text-success-700')}>{r.error ?? 'Valid'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

/** Row and columns of the heading, found by name whatever its spacing and case. */
export function findHeader(table: string[][], required: string[]) {
  const norm = (s: string) => s.replace(/[\s_]/g, '').toLowerCase();
  const row = table.findIndex((r) => required.every((h) => r.some((c) => norm(c) === norm(h))));
  if (row < 0) throw new Error(`The sheet must have the column${required.length > 1 ? 's' : ''} ${required.join(' and ')}.`);
  const header = table[row]!;
  return { row, header, col: (h: string) => header.findIndex((c) => norm(c) === norm(h)), is: (c: string, h: string) => norm(c) === norm(h) };
}
