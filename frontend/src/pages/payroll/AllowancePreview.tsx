import { useQuery } from '@tanstack/react-query';
import { createColumnHelper } from '@tanstack/react-table';
import { AlertTriangle, CheckCircle2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { DataTable } from '@/components/ui/DataTable';
import { PageHeader } from '@/components/ui/PageHeader';
import { Select } from '@/components/ui/Select';
import { formatDate, formatINR, MONTHS } from '@/lib/format';
import { errorMessage } from '@/services/api';
import { payrollApi } from '@/services/payroll';
import type { AllowancePreviewRow, HraMethod } from '@/types/api';

/** Payroll › Processing › Allowance Preview (specs/06): DA, HRA, CCA and MA for a salary month. Nothing is saved. */
const col = createColumnHelper<AllowancePreviewRow>();
const methodText: Record<HraMethod, string> = { PLACE: '% by place', DESIGNATION: '% by designation', FIXED_AMOUNT: 'Fixed amount' };
const right = (header: string) => () => <span className="block text-right">{header}</span>;

const inr = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 2 });
/** 15542.00 → 15,542 (no ₹ or empty paise: the grid is wide). */
const amount = (v: string) => inr.format(Number(v));

/** Allowances are whole rupees; pay may carry paise. Sorting is by value, with missing amounts first. */
const money = (key: 'basic' | 'pp' | 'gp' | 'basicPay' | 'da' | 'hra' | 'cca' | 'ma' | 'total', header: string, bold = false) =>
  col.accessor((r) => (r[key] === null ? -1 : Number(r[key])), {
    id: key,
    header: right(header),
    cell: (c) => {
      const v = c.row.original[key];
      return v === null
        ? <span className="block text-right font-semibold text-danger-700">Missing</span>
        : <span className={`block text-right tabular-nums ${bold ? 'font-semibold' : ''}`}>{amount(v)}</span>;
    },
  });

const columns = [
  col.accessor('employeeName', {
    header: 'Employee',
    cell: (c) => (
      <span>
        <span className="block font-medium">{c.getValue()}</span>
        <span className="block text-xs text-ink-500">{c.row.original.employeeCode ?? '—'} · {c.row.original.designation}</span>
        {c.row.original.issues.length > 0 && (
          <ul className="mt-1 max-w-[18rem] space-y-0.5 whitespace-normal text-xs">
            {c.row.original.issues.map((i) => (
              <li key={i.code + i.message} className={i.severity === 'ERROR' ? 'text-danger-700' : 'text-warning-700'}>{i.message}</li>
            ))}
          </ul>
        )}
      </span>
    ),
  }),
  col.accessor('branch', {
    header: 'Branch',
    cell: (c) => (
      <span>
        <span className="block">{c.getValue()}</span>
        <span className="block text-xs text-ink-500">{c.row.original.place ?? 'No place category'}</span>
      </span>
    ),
  }),
  money('basic', 'Basic'),
  money('pp', 'PP'),
  money('gp', 'GP'),
  money('basicPay', 'Basic Pay', true),
  money('da', 'DA'),
  money('hra', 'HRA'),
  money('cca', 'CCA'),
  money('ma', 'MA'),
  money('total', 'Total', true),
];

export function AllowancePreviewPage() {
  const [chosen, setChosen] = useState('');
  const [onlyIssues, setOnlyIssues] = useState(false);
  const periods = useQuery({ queryKey: ['payroll-periods', 'SALARY'], queryFn: () => payrollApi.periods.list({ payrollType: 'SALARY' }) });
  // Newest first; start on the earliest period still to be finalised.
  const pending = (periods.data ?? []).filter((p) => p.payroll_status === 'OPEN' || p.payroll_status === 'PROCESSED');
  const periodId = chosen || String((pending[pending.length - 1] ?? periods.data?.[0])?.id ?? '');
  const q = useQuery({ queryKey: ['allowance-preview', periodId], queryFn: () => payrollApi.periods.allowances(Number(periodId)), enabled: !!periodId });
  const d = q.data;
  const rows = useMemo(() => (d?.employees ?? []).filter((e) => !onlyIssues || e.issues.length > 0), [d, onlyIssues]);

  const toCheck = (d?.employees ?? []).filter((e) => e.issues.length > 0).length;

  return (
    <>
      <PageHeader title="Allowance Preview" subtitle="Basic Pay (Basic + Personal Pay + Grade Pay), DA, HRA, CCA and MA for a full month · nothing is saved" />

      <div className="mb-4 flex flex-wrap items-end gap-4">
        <div className="w-64">
          <Select
            label="Salary period"
            placeholder={periods.isLoading ? 'Loading…' : 'Select period'}
            value={periodId}
            onChange={(e) => setChosen(e.target.value)}
            options={(periods.data ?? []).map((p) => ({ value: p.id, label: `${MONTHS[p.month - 1]} ${p.calendar_year} (${p.payroll_status.toLowerCase()})` }))}
          />
        </div>
        <label className="flex items-center gap-2 pb-2 text-sm text-ink-600">
          <input type="checkbox" className="accent-brand-600" checked={onlyIssues} onChange={(e) => setOnlyIssues(e.target.checked)} /> Only employees to check
        </label>
      </div>

      {periods.data?.length === 0 && <p className="card p-5 text-sm text-ink-600">No salary period exists yet. Create one in Payroll Periods.</p>}
      {(periods.isError || q.isError) && <p role="alert" className="mb-4 rounded-lg bg-danger-50 px-3 py-2 text-sm text-danger-700">{errorMessage(periods.error ?? q.error)}</p>}

      {d && (
        <>
          <dl className="card mb-4 flex flex-wrap gap-x-8 gap-y-2 p-4 text-sm">
            <Item label="Period" value={`${formatDate(d.period.fromDate)} to ${formatDate(d.period.toDate)}`} />
            <Item label="DA rate" value={d.daRate ? `${Number(d.daRate.percentage).toFixed(2)} % from ${formatDate(d.daRate.effectiveFrom)}` : 'Missing'} />
            <Item label="HRA method" value={methodText[d.method]} />
            <Item label="Medical Allowance" value={d.medicalAmount === null ? 'Missing' : formatINR(d.medicalAmount)} />
            <Item label="Employees" value={String(d.employeeCount)} />
          </dl>
          {d.ready && toCheck > 0 ? (
            <p role="status" className="mb-4 flex items-center gap-2 rounded-lg bg-warning-50 px-4 py-2 text-sm text-warning-700">
              <AlertTriangle size={16} /> Nothing is missing, but {toCheck} of {d.employeeCount} employees have something to check, such as a rate of 0.
            </p>
          ) : d.ready ? (
            <p className="mb-4 flex items-center gap-2 rounded-lg bg-success-50 px-4 py-2 text-sm text-success-700"><CheckCircle2 size={16} /> Nothing is missing for this period.</p>
          ) : (
            <p role="status" className="mb-4 flex items-center gap-2 rounded-lg bg-danger-50 px-4 py-2 text-sm text-danger-700">
              <AlertTriangle size={16} /> {d.employeesWithErrors} of {d.employeeCount} employees have something missing. Payroll must not be finalised until these are set.
            </p>
          )}
        </>
      )}
      {periodId && !q.isError && <DataTable data={rows} columns={columns} loading={q.isLoading} empty={onlyIssues ? 'No employees to check' : 'No serving employees in this period'} />}
    </>
  );
}

const Item = ({ label, value }: { label: string; value: string }) => (
  <div>
    <dt className="text-xs font-semibold uppercase tracking-wide text-ink-500">{label}</dt>
    <dd className="font-medium text-ink-900">{value}</dd>
  </div>
);
