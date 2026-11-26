import { useQuery } from '@tanstack/react-query';
import { FileDown, FileSpreadsheet, Printer } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { abstractLabel, cellMoney, downloadBlob, money, payBillColumns, rowValues, titleLines, totalValues, type PayBillCol } from '@/lib/payBill';
import { errorMessage } from '@/services/api';
import { payrollApi } from '@/services/payroll';
import type { PayBillReport } from '@/types/api';
import { ErrorText } from './shared';

/** Pay Bill (specs/08 §4.7): preview of the print, with PDF (view / download) and Excel. Follows the Branch view. */
export function PayBillDialog({ periodId, branchId, onClose }: { periodId: number; branchId?: number; onClose: () => void }) {
  const q = useQuery({ queryKey: ['pay-bill-report', periodId, branchId ?? 0], queryFn: () => payrollApi.preparation.payBill(periodId, branchId), gcTime: 0 });
  const [busy, setBusy] = useState<'view' | 'pdf' | 'xlsx' | null>(null);
  const [error, setError] = useState<unknown>(null);
  const r = q.data;

  const run = (kind: 'view' | 'pdf' | 'xlsx') => async () => {
    if (!r) return;
    setBusy(kind);
    setError(null);
    try {
      if (kind === 'xlsx') await (await import('@/lib/payBillExcel')).downloadPayBillExcel(r);
      else {
        const { blob, name } = await (await import('@/lib/payBillPdf')).payBillPdf(r);
        if (kind === 'pdf') downloadBlob(blob, name);
        else {
          const url = URL.createObjectURL(blob);
          if (!window.open(url, '_blank')) downloadBlob(blob, name);
          setTimeout(() => URL.revokeObjectURL(url), 60_000);
        }
      }
    } catch (e) {
      setError(e);
    } finally {
      setBusy(null);
    }
  };

  return (
    <Modal open size="xl" title="Pay Bill" onClose={onClose}>
      {q.isLoading && <p className="text-sm text-ink-500">Loading…</p>}
      {q.isError && <ErrorText>{errorMessage(q.error)}</ErrorText>}
      {r && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-end gap-2">
            {!!error && <span role="alert" className="mr-auto text-sm text-danger-600">{errorMessage(error)}</span>}
            <Button variant="secondary" disabled={!!busy} onClick={run('view')}><Printer size={14} /> {busy === 'view' ? 'Opening…' : 'View / Print PDF'}</Button>
            <Button variant="secondary" disabled={!!busy} onClick={run('pdf')}><FileDown size={14} /> {busy === 'pdf' ? 'Preparing…' : 'Download PDF'}</Button>
            <Button variant="secondary" disabled={!!busy} onClick={run('xlsx')}><FileSpreadsheet size={14} /> {busy === 'xlsx' ? 'Preparing…' : 'Download Excel'}</Button>
          </div>
          <Preview r={r} />
        </div>
      )}
    </Modal>
  );
}

function Preview({ r }: { r: PayBillReport }) {
  const t = titleLines(r);
  const cols = payBillColumns(r);
  const a = r.abstract;
  const align = (c: PayBillCol) => (c.kind === 'amount' || c.kind === 'total' || c.kind === 'days' ? 'text-right' : 'text-left');
  const show = (v: string | number, c: PayBillCol) => (c.kind === 'amount' || c.kind === 'total' ? cellMoney(v) : String(v));
  const cells = (values: Array<string | number>, bold = false) =>
    values.map((v, i) => {
      const c = cols[i]!;
      if (c.key === 'name' && typeof v === 'string' && v.includes('\n')) {
        const [name, des] = v.split('\n');
        return <td key={c.key} className="whitespace-nowrap border border-ink-200 px-1.5 py-1"><div className="font-medium">{name}</div><div className="text-[10px] text-ink-500">{des}</div></td>;
      }
      return (
        <td key={c.key} className={`whitespace-nowrap border border-ink-200 px-1.5 py-1 tabular-nums ${align(c)} ${bold || c.kind === 'total' ? 'font-semibold' : ''} ${v === 'WITHHELD' ? 'font-semibold text-danger-600' : ''}`}>
          {show(v, c)}
        </td>
      );
    });

  return (
    <div className="space-y-4 text-xs">
      <div className="text-center">
        <p className="text-sm font-bold">{t.org}</p>
        {t.address && <p>{t.address}</p>}
        <p className="mt-1 font-bold">{t.title}</p>
        <p className="mt-1 text-ink-600">{t.meta}</p>
        {t.stamp && <p className="mt-1 font-bold text-danger-600">*** {t.stamp} ***</p>}
      </div>

      <div className="max-h-[60vh] overflow-auto rounded border border-ink-200">
        <table className="min-w-full border-collapse">
          <thead className="sticky top-0 z-10 bg-ink-100">
            <tr>{cols.map((c) => <th key={c.key} title={r.columns.find((x) => x.key === c.key)?.name} className={`whitespace-nowrap border border-ink-200 px-1.5 py-1 font-semibold ${align(c)}`}>{c.label}</th>)}</tr>
          </thead>
          <tbody>
            {r.branches.map((b) => [
              <tr key={`h${b.branchId}`} className="bg-ink-50"><td colSpan={cols.length} className="border border-ink-200 px-1.5 py-1 font-bold">BRANCH: {b.branchName.toUpperCase()} ({b.count})</td></tr>,
              ...b.rows.map((row) => <tr key={row.payrollId}>{cells(rowValues(cols, row))}</tr>),
              <tr key={`t${b.branchId}`} className="bg-ink-50">{cells(totalValues(cols, `${b.branchName} Total`, b.totals), true)}</tr>,
            ])}
            <tr className="bg-ink-100">{cells(totalValues(cols, `GRAND TOTAL (${a.employees})`, r.totals), true)}</tr>
          </tbody>
        </table>
      </div>

      <div className="rounded border border-ink-200 p-3">
        <p className="mb-2 text-center text-sm font-bold">ABSTRACT</p>
        <div className="grid gap-6 sm:grid-cols-2">
          {([['Earnings', a.earnings, 'GROSS', a.gross], ['Deductions', a.deductions, 'TOTAL DEDUCTIONS', a.deductionsTotal]] as const).map(([title, items, total, sum]) => (
            <table key={title} className="w-full self-start">
              <thead><tr className="border-b border-ink-300 text-left font-semibold"><th className="py-1">{title}</th><th className="py-1 text-right">Amount</th></tr></thead>
              <tbody>{items.map((i) => <tr key={i.label} className="border-b border-ink-100"><td className="py-1">{abstractLabel(i)}</td><td className="py-1 text-right tabular-nums">{money(i.amount)}</td></tr>)}</tbody>
              <tfoot><tr className="font-bold"><td className="py-1">{total}</td><td className="py-1 text-right tabular-nums">{money(sum)}</td></tr></tfoot>
            </table>
          ))}
        </div>
        <p className="mt-3 text-sm font-bold">NET PAY: ₹{money(a.net)}</p>
        <p className="text-ink-600">({a.netInWords})</p>
        <p className="mt-2 text-ink-600">
          {a.byBranch.map((b) => `${b.branchName}: ${b.count}`).join(' · ')}
          {a.withheld.count > 0 && ` · Withheld: ${a.withheld.count} bill(s), ₹${money(a.withheld.net)}`}
        </p>
        <div className="mt-8 grid grid-cols-3 gap-6 text-center text-ink-600">
          {['Prepared by', 'Checked by', 'Approved by'].map((s) => <div key={s} className="border-t border-ink-400 pt-1">{s}</div>)}
        </div>
      </div>
      <p className="text-right text-[10px] text-ink-500">{t.generated}</p>
    </div>
  );
}
