import { useQuery } from '@tanstack/react-query';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { Detail } from '@/components/ui/Section';
import { formatINR, humanize } from '@/lib/format';
import { errorMessage } from '@/services/api';
import { payrollApi } from '@/services/payroll';
import { amount, ErrorText } from './shared';

/** One pay bill with its lines. Employer PF is on both sides. */
export function BillDialog({ billId, onClose }: { billId: number; onClose: () => void }) {
  const q = useQuery({ queryKey: ['pay-bill', billId], queryFn: () => payrollApi.preparation.bill(billId) });
  const b = q.data;
  const side = (title: string, key: 'allowance_amount' | 'deduction_amount', total: string) => (
    <table className="w-full self-start text-sm">
      <thead className="text-left text-xs font-semibold uppercase tracking-wide text-ink-500"><tr><th className="py-1">{title}</th><th /></tr></thead>
      <tbody className="divide-y divide-ink-100">
        {b!.lines.filter((l) => Number(l[key]) !== 0).map((l) => (
          <tr key={l.id}><td className="py-1 pr-3">{l.component_name}</td><td className="py-1 text-right tabular-nums">{amount(l[key])}</td></tr>
        ))}
      </tbody>
      <tfoot className="border-t border-ink-300 font-semibold"><tr><td className="py-1">Total</td><td className="py-1 text-right tabular-nums">{amount(total)}</td></tr></tfoot>
    </table>
  );
  return (
    <Modal open size="lg" title={b ? `${b.employee_code} — ${b.employee_name}` : 'Pay bill'} onClose={onClose}>
      {q.isLoading && <p className="text-sm text-ink-500">Loading…</p>}
      {q.isError && <ErrorText>{errorMessage(q.error)}</ErrorText>}
      {b && (
        <div className="space-y-4">
          <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Detail label="Designation" value={b.designation_name} />
            <Detail label="Branch" value={b.branch_name} />
            <Detail label="Pay days" value={`${Number(b.payable_days)} of ${Number(b.working_days)}`} />
            <Detail label="Status" value={`${humanize(b.payroll_status)}${b.is_withheld ? ' · withheld' : ''}`} />
          </dl>
          <div className="grid gap-6 sm:grid-cols-2">{side('Earnings', 'allowance_amount', b.gross_earnings)}{side('Deductions', 'deduction_amount', b.total_deductions)}</div>
          <p className="rounded-lg bg-ink-50 px-3 py-2 text-right text-sm">Net pay <b className="ml-2 text-base tabular-nums">{formatINR(b.net_salary)}</b></p>
          {b.issues.length > 0 && (
            <ul className="space-y-1 text-sm">{b.issues.map((i) => <li key={i.code + i.message} className={i.severity === 'ERROR' ? 'text-danger-700' : 'text-warning-700'}>{i.message}</li>)}</ul>
          )}
          <div className="flex justify-end"><Button variant="secondary" onClick={onClose}>Close</Button></div>
        </div>
      )}
    </Modal>
  );
}
