import { useMutation, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { Detail } from '@/components/ui/Section';
import { formatINR } from '@/lib/format';
import { errorMessage } from '@/services/api';
import { payrollApi } from '@/services/payroll';
import type { ManualDeductions, PrepareResult } from '@/types/api';
import { amount, ErrorText, mayClose } from './shared';

type Row = ManualDeductions['rows'][number];
interface Draft { amount: string; remarks: string }
const draftOf = (r: Row): Draft => ({ amount: r.override === null ? '' : String(Number(r.override)), remarks: r.remarks });
const isMoney = (v: string) => /^(\d+(\.\d{1,2})?)?$/.test(v.trim());

interface Props { periodId: number; employeeId: number; onClose: () => void; onSaved: (r: PrepareResult) => void }

export function EditDeductionsDialog({ periodId, employeeId, onClose, onSaved }: Props) {
  const q = useQuery({ queryKey: ['manual-deductions', periodId, employeeId], queryFn: () => payrollApi.manualDeductions.get(periodId, employeeId), refetchOnWindowFocus: false, gcTime: 0 });
  const d = q.data;
  const [drafts, setDrafts] = useState<Record<number, Draft>>({});
  const valueOf = (r: Row) => drafts[r.componentId] ?? draftOf(r);
  const changed = (d?.rows ?? []).filter((r) => {
    const x = valueOf(r);
    const o = draftOf(r);
    return x.amount.trim() !== o.amount || x.remarks.trim() !== o.remarks;
  });
  const invalid = changed.some((r) => !isMoney(valueOf(r).amount));
  const set = (r: Row, patch: Partial<Draft>) => setDrafts((all) => ({ ...all, [r.componentId]: { ...valueOf(r), ...patch } }));

  // Blank = the calculated amount. The server's net already has the saved edits in it.
  const paise = (v: string | number) => Math.round(Number(v) * 100);
  const effective = (r: Row, text: string) => (text.trim() === '' ? paise(r.calculated ?? 0) : paise(text));
  const preview = d && !invalid
    ? (paise(d.net) + d.rows.filter((r) => r.applies).reduce((n, r) => n + effective(r, draftOf(r).amount) - effective(r, valueOf(r).amount), 0)) / 100
    : null;

  const save = useMutation({
    mutationFn: () =>
      payrollApi.manualDeductions.save(periodId, employeeId, changed.map((r) => {
        const x = valueOf(r);
        return { componentId: r.componentId, amount: x.amount.trim() === '' ? null : Number(x.amount), remarks: x.amount.trim() === '' ? '' : x.remarks };
      })),
    onSuccess: onSaved,
  });
  const close = () => mayClose(changed.length > 0) && onClose();

  return (
    <Modal open size="lg" title={d ? `Edit deductions · ${d.employeeCode} — ${d.employeeName}` : 'Edit deductions'} onClose={close}>
      <div className="space-y-4">
        {q.isLoading && <p className="text-sm text-ink-500">Loading…</p>}
        {q.isError && <ErrorText>{errorMessage(q.error)}</ErrorText>}
        {d && (
          <>
            <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Detail label="Gross (excl. employer PF)" value={formatINR(d.gross)} />
              <Detail label={`Minimum net (${Number(d.minNetPercent)}%)`} value={formatINR(d.minimumNet)} />
              <Detail label="Net now" value={formatINR(d.net)} />
              <Detail label="Net preview" value={preview === null ? '—' : <b className={preview < Number(d.minimumNet) ? 'text-danger-700' : 'text-success-700'}>{formatINR(preview)}</b>} />
            </dl>
            <div className="overflow-x-auto rounded-lg border border-ink-200">
              <table className="min-w-full text-sm">
                <thead className="bg-ink-50 text-left text-xs font-semibold uppercase tracking-wide text-ink-500">
                  <tr><th className="px-3 py-2">Deduction</th><th className="px-3 py-2 text-right">Calculated</th><th className="px-3 py-2">Override</th><th className="px-3 py-2">Remarks</th></tr>
                </thead>
                <tbody className="divide-y divide-ink-100">
                  {d.rows.length === 0 && <tr><td colSpan={4} className="px-3 py-6 text-center text-ink-400">No deductions on this pay bill</td></tr>}
                  {d.rows.map((r) => {
                    const x = valueOf(r);
                    return (
                      <tr key={r.componentId}>
                        <td className="px-3 py-1.5">
                          <span className="block font-medium">{r.componentName}</span>
                          <span className="text-xs text-ink-500">{r.applies ? r.componentCode : 'No longer on the pay bill: not applied'}</span>
                        </td>
                        <td className="px-3 py-1.5 text-right tabular-nums">{r.calculated === null ? '—' : amount(r.calculated)}</td>
                        <td className="px-2 py-1.5">
                          {r.applies ? (
                            <input aria-label={`Override of ${r.componentCode}`} inputMode="decimal" disabled={!d.editable} value={x.amount} aria-invalid={!isMoney(x.amount)} placeholder="As calculated"
                              className="field-input w-32 px-2 py-1 text-right tabular-nums aria-[invalid=true]:border-danger-500" onChange={(e) => set(r, { amount: e.target.value })} />
                          ) : x.amount === '' ? <span className="text-ink-500">Will be removed</span> : (
                            <span className="flex items-center gap-2 tabular-nums">{amount(x.amount)} <Button variant="secondary" className="px-2 py-1 text-xs" onClick={() => set(r, { amount: '' })}>Remove</Button></span>
                          )}
                        </td>
                        <td className="px-2 py-1.5"><input aria-label={`Remarks for ${r.componentCode}`} maxLength={500} disabled={!d.editable || !r.applies} value={x.remarks} className="field-input px-2 py-1" onChange={(e) => set(r, { remarks: e.target.value })} /></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <p className="text-xs text-ink-500">A blank override means the calculated amount; 0 deducts nothing. Saving prepares the whole run again. Overrides are kept when payroll is prepared again.</p>
          </>
        )}
        {invalid && <ErrorText>Enter an amount with at most 2 decimal places.</ErrorText>}
        {save.isError && <ErrorText>{errorMessage(save.error)}</ErrorText>}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={close}>Cancel</Button>
          {d?.editable && <Button disabled={changed.length === 0 || invalid || save.isPending} onClick={() => save.mutate()}>{save.isPending ? 'Preparing…' : 'Save & Re-prepare'}</Button>}
        </div>
      </div>
    </Modal>
  );
}
