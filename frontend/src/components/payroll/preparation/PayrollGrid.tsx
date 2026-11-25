import { createColumnHelper } from '@tanstack/react-table';
import { Download, Eye, Pencil } from 'lucide-react';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { DataTable } from '@/components/ui/DataTable';
import { Field } from '@/components/ui/Field';
import { Pagination } from '@/components/ui/Pagination';
import { formatINR, humanize } from '@/lib/format';
import { writeSheet, type Cell } from '@/lib/spreadsheet';
import type { BillColumn, PayBill } from '@/types/api';
import { amount } from './shared';

const col = createColumnHelper<PayBill>();
const right = (header: string) => () => <span className="block text-right">{header}</span>;
const Right = ({ children, bold }: { children: ReactNode; bold?: boolean }) => <span className={`block text-right tabular-nums ${bold ? 'font-semibold' : ''}`}>{children}</span>;
const days = (v: string | null) => Number(v ?? 0);
const lop = (b: PayBill) => days(b.service_days) - days(b.payable_days);
const sum = (list: PayBill[], of: (b: PayBill) => string) => list.reduce((n, b) => n + Math.round(Number(of(b)) * 100), 0) / 100;

/** [column, heading, hidden when 0 for everyone] */
const EARNINGS: Array<[BillColumn, string, boolean]> = [
  ['basic', 'Basic', false], ['pp', 'PP', true], ['gp', 'GP', true], ['sp', 'SP', true], ['pay', 'PAY', false], ['da', 'DA', false], ['hra', 'HRA', false],
  ['cca', 'CCA', false], ['ma', 'MA', false], ['employerPf', 'Emp PF (Cr)', true], ['otherEarnings', 'Other', false],
];
const DEDUCTIONS: Array<[BillColumn, string, boolean]> = [['pf', 'PF', false], ['vpf', 'VPF', true], ['employerPf', 'Emp PF (Dr)', true], ['otherDeductions', 'Other Ded', false]];

const STATUS_TONE = { DRAFT: 'neutral', APPROVED: 'success', PAID: 'brand' } as const;
const rowColour = (b: PayBill) =>
  b.is_withheld && b.payroll_status !== 'PAID' ? 'bg-warning-50'
  : b.payroll_status === 'APPROVED' ? 'bg-success-50'
  : b.payroll_status === 'PAID' ? 'bg-sky-50'
  : b.issues.some((i) => i.severity === 'ERROR' || i.code === 'NET_LOW') ? 'bg-danger-50'
  : undefined;

interface Props {
  bills: PayBill[];
  loading: boolean;
  fileLabel: string;
  canWithhold: boolean;
  canEditDeductions: boolean;
  busy: boolean;
  onView: (b: PayBill) => void;
  onEdit: (b: PayBill) => void;
  onWithhold: (b: PayBill) => void;
}

export function PayrollGrid({ bills, loading, fileLabel, canWithhold, canEditDeductions, busy, onView, onEdit, onWithhold }: Props) {
  const [filter, setFilter] = useState('');
  const [page, setPage] = useState(1);
  const [size, setSize] = useState(20);
  const term = filter.trim().toLowerCase();
  const rows = useMemo(() => bills.filter((b) => !term || [b.employee_code, b.employee_name, b.branch_name, b.designation_name].some((v) => v.toLowerCase().includes(term))), [bills, term]);
  useEffect(() => setPage(1), [term, size, bills.length]);

  const shown = (list: typeof EARNINGS) => list.filter(([key, , hide]) => !hide || bills.some((b) => Number(b.amounts[key]) !== 0));
  const earnings = shown(EARNINGS);
  const deductions = shown(DEDUCTIONS);

  const columns = useMemo(() => {
    const money = (list: typeof EARNINGS, side: string) =>
      list.map(([key, header]) => col.accessor((b) => Number(b.amounts[key]), { id: `${side}-${key}`, header: right(header), cell: (c) => <Right>{amount(c.getValue())}</Right> }));
    const total = (id: string, header: string, of: (b: PayBill) => string) => col.accessor((b) => Number(of(b)), { id, header: right(header), cell: (c) => <Right bold>{amount(c.getValue())}</Right> });
    return [
      col.accessor('branch_name', { header: 'Branch' }),
      col.accessor('employee_code', { header: 'Code' }),
      col.accessor('employee_name', { header: 'Employee', cell: (c) => <span><span className="block font-medium">{c.getValue()}</span><span className="block text-xs text-ink-500">{c.row.original.designation_name}</span></span> }),
      col.accessor(lop, { id: 'lop', header: right('LOP'), cell: (c) => <Right>{c.getValue()}</Right> }),
      col.accessor((b) => days(b.payable_days), { id: 'payDays', header: right('Pay days'), cell: (c) => <Right>{c.getValue()}</Right> }),
      ...money(earnings, 'e'),
      total('gross', 'Gross', (b) => b.gross_earnings),
      ...money(deductions, 'd'),
      total('totalDed', 'Total Ded', (b) => b.total_deductions),
      total('net', 'Net', (b) => b.net_salary),
      col.accessor('payroll_status', { header: 'Status', cell: (c) => <Badge tone={STATUS_TONE[c.getValue()]}>{humanize(c.getValue())}</Badge> }),
      col.accessor('is_withheld', {
        header: 'Withhold',
        cell: (c) => (
          <input
            type="checkbox" className="accent-brand-600" aria-label={`Withhold ${c.row.original.employee_code}`} checked={c.getValue()}
            disabled={!canWithhold || busy || c.row.original.payroll_status === 'PAID'} onChange={() => onWithhold(c.row.original)}
          />
        ),
      }),
      col.accessor((b) => b.withhold_reason ?? '', { id: 'reason', header: 'Reason', cell: (c) => <span className="block max-w-[12rem] truncate" title={c.getValue()}>{c.getValue()}</span> }),
      col.display({
        id: 'actions',
        header: '',
        cell: ({ row: { original: b } }) => (
          <span className="flex gap-1">
            <Button variant="ghost" className="px-2 py-1" title="View pay bill" aria-label={`View ${b.employee_code}`} onClick={() => onView(b)}><Eye size={14} /></Button>
            {canEditDeductions && <Button variant="ghost" className="px-2 py-1" title="Edit deductions" aria-label={`Edit deductions of ${b.employee_code}`} disabled={busy} onClick={() => onEdit(b)}><Pencil size={14} /></Button>}
          </span>
        ),
      }),
    ];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [earnings.length, deductions.length, canWithhold, canEditDeductions, busy, bills]);

  const totals = { gross: sum(rows, (b) => b.gross_earnings), pf: sum(rows, (b) => b.amounts.pf), totalDed: sum(rows, (b) => b.total_deductions), net: sum(rows, (b) => b.net_salary) };
  const footer = { branch_name: 'Total', gross: <Right>{amount(totals.gross)}</Right>, 'd-pf': <Right>{amount(totals.pf)}</Right>, totalDed: <Right>{amount(totals.totalDed)}</Right>, net: <Right>{amount(totals.net)}</Right> };

  const exportRows = () => {
    const head = ['Branch', 'Code', 'Employee', 'Designation', 'LOP', 'Pay days', ...earnings.map(([, h]) => h), 'Gross', ...deductions.map(([, h]) => h), 'Total Ded', 'Net', 'Status', 'Withheld', 'Reason'];
    const body: Cell[][] = rows.map((b) => [
      b.branch_name, b.employee_code, b.employee_name, b.designation_name, lop(b), days(b.payable_days), ...earnings.map(([k]) => Number(b.amounts[k])), Number(b.gross_earnings),
      ...deductions.map(([k]) => Number(b.amounts[k])), Number(b.total_deductions), Number(b.net_salary), humanize(b.payroll_status), b.is_withheld ? 'Yes' : '', b.withhold_reason,
    ]);
    void writeSheet(`payroll-${fileLabel}`, [head, ...body], 'xlsx');
  };

  return (
    <>
      <div className="mb-3 flex flex-wrap items-end gap-3">
        <div className="w-64"><Field label="Find" name="find-bill" placeholder="Code, name, branch or designation" value={filter} onChange={(e) => setFilter(e.target.value)} /></div>
        <label className="text-sm text-ink-600">
          <span className="field-label">Rows</span>
          <select className="field-input" value={size} onChange={(e) => setSize(Number(e.target.value))}>{[10, 20, 50, 100].map((n) => <option key={n} value={n}>{n}</option>)}</select>
        </label>
        <Button variant="secondary" className="ml-auto" disabled={rows.length === 0} onClick={exportRows}><Download size={14} /> Excel</Button>
      </div>
      <DataTable data={rows} columns={columns} loading={loading} empty={bills.length ? 'No employee matches' : 'Payroll is not prepared yet'} pinActions rowClassName={rowColour} footer={footer} page={{ index: page - 1, size }} />
      {rows.length > 0 && (
        <>
          <Pagination page={page} pageSize={size} total={rows.length} onPage={setPage} />
          <p className="mt-2 text-sm text-ink-700">
            {rows.length} employee(s) · Gross <b>{formatINR(totals.gross)}</b> · Deductions <b>{formatINR(totals.totalDed)}</b> · Net <b>{formatINR(totals.net)}</b>
          </p>
          <p className="mt-1 text-xs text-ink-500">Amber: withheld · green: approved · blue: paid · red: an error, or net pay below the minimum.</p>
        </>
      )}
    </>
  );
}
