import { useQuery } from '@tanstack/react-query';
import { Badge } from '@/components/ui/Badge';
import { formatDate, formatINR } from '@/lib/format';
import { errorMessage } from '@/services/api';
import { payrollApi } from '@/services/payroll';
import { ErrorText } from './shared';

const STATUS = { NOT_UPLOADED: ['Not uploaded', 'danger'], PARTIAL: ['Partial', 'warning'], UPLOADED: ['Uploaded', 'success'] } as const;

/** What has been uploaded for the month (spec 08 §4.2). For information: it does not stop Prepare. */
export function ReadinessPanel({ periodId }: { periodId: number }) {
  const q = useQuery({ queryKey: ['payroll-readiness', periodId], queryFn: () => payrollApi.preparation.readiness(periodId) });
  const d = q.data;
  if (q.isError) return <ErrorText>{errorMessage(q.error)}</ErrorText>;
  if (!d) return null;
  const [text, tone] = STATUS[d.attendance.status];
  return (
    <section aria-label="Upload status" className="card p-4 text-sm">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-1">
        <h2 className="text-xs font-bold uppercase tracking-wide text-ink-700">Upload status</h2>
        <span className="flex items-center gap-2">Attendance <Badge tone={tone}>{text}</Badge> {d.attendance.entered} of {d.attendance.total} employees{d.attendance.firstUploadedAt && ` · ${formatDate(d.attendance.firstUploadedAt)}`}</span>
        <span className="ml-auto font-semibold text-ink-800">{d.message}</span>
      </div>
      {d.agencies.length > 0 && (
        <details className="mt-3">
          <summary className="cursor-pointer text-ink-600">Agencies: {d.agencies.filter((a) => a.uploaded > 0).length} of {d.agencies.length} uploaded</summary>
          <table className="mt-2 min-w-full text-sm">
            <thead className="text-left text-xs font-semibold uppercase tracking-wide text-ink-500">
              <tr><th className="py-1 pr-4">Agency</th><th className="py-1 pr-4">Upload</th><th className="py-1 pr-4">Employees</th><th className="py-1 pr-4 text-right">Will deduct</th><th className="py-1">First upload</th></tr>
            </thead>
            <tbody className="divide-y divide-ink-100">
              {d.agencies.map((a) => (
                <tr key={a.componentId}>
                  <td className="py-1 pr-4">{a.name} <span className="text-ink-500">({a.code})</span></td>
                  <td className="py-1 pr-4"><Badge tone={a.uploaded ? 'success' : 'neutral'}>{a.uploaded ? 'Uploaded' : 'Pending'}</Badge></td>
                  <td className="py-1 pr-4 tabular-nums">{a.uploaded} / {a.eligible}</td>
                  <td className="py-1 pr-4 text-right tabular-nums">{a.employees === 0 ? <b className="text-warning-700">₹0 — nothing</b> : `${formatINR(a.amount)} from ${a.employees}`}</td>
                  <td className="py-1">{formatDate(a.firstUploadedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-2 text-xs text-ink-500">A pending agency is deducted at the assigned amounts.</p>
        </details>
      )}
    </section>
  );
}
