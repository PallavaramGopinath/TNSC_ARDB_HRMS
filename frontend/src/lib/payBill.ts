/**
 * Pay Bill print (specs/08 §4.7): the one layout the preview, the PDF and the Excel sheet share.
 * Columns: S.No | Code | Name / Designation | Pay days | LOP | earnings… | GROSS | deductions… | TOTAL DED | NET PAY | Signature
 */
import { formatDate, MONTHS } from './format';
import type { PayBillReport, PayBillReportRow } from '@/types/api';

const inr = new Intl.NumberFormat('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
/** 1,40,220 (Indian grouping, no symbol: the PDF font has no ₹). */
export const money = (v: string | number | undefined) => inr.format(Number(v ?? 0));
/** Same, but blank for zero: pay bill cells. */
export const cellMoney = (v: string | number | undefined) => (Number(v ?? 0) === 0 ? '' : money(v));
/** Abstract line: the full name, with the column heading when it differs ("PF Loan Principal (PFL)"). */
export const abstractLabel = (i: { label: string; name?: string | null }) => {
  const name = i.name || i.label;
  const side = /\((Cr|Dr)\)$/.exec(i.label);
  if (side) return name === i.label ? name : `${name} (${side[1]})`;
  return name.toUpperCase() === i.label.toUpperCase() || i.label.length > 12 ? name : `${name} (${i.label})`;
};

export interface PayBillCol { key: string; label: string; kind: 'text' | 'days' | 'amount' | 'total' | 'sign' }

export function payBillColumns(r: PayBillReport): PayBillCol[] {
  const side = (s: 'EARNING' | 'DEDUCTION') => r.columns.filter((c) => c.side === s).map((c) => ({ key: c.key, label: c.label, kind: 'amount' as const }));
  return [
    { key: 'serial', label: 'S.No', kind: 'text' },
    { key: 'code', label: 'Code', kind: 'text' },
    { key: 'name', label: 'Name / Designation', kind: 'text' },
    { key: 'payDays', label: 'Pay days', kind: 'days' },
    { key: 'lop', label: 'LOP', kind: 'days' },
    ...side('EARNING'),
    { key: 'gross', label: 'GROSS', kind: 'total' },
    ...side('DEDUCTION'),
    { key: 'deductions', label: 'TOTAL DED', kind: 'total' },
    { key: 'net', label: 'NET PAY', kind: 'total' },
    { key: 'sign', label: 'Signature', kind: 'sign' },
  ];
}

const isAmount = (c: PayBillCol) => c.kind === 'amount' || c.kind === 'total';

/** One employee: amounts as numbers, the rest as text. */
export function rowValues(cols: PayBillCol[], row: PayBillReportRow): Array<string | number> {
  return cols.map((c) => {
    if (isAmount(c)) return Number(row.amounts[c.key] ?? 0);
    switch (c.key) {
      case 'serial': return row.serial;
      case 'code': return row.employeeCode;
      case 'name': return `${row.employeeName}\n${row.designation}`;
      case 'payDays': return Number(row.payDays);
      case 'lop': return Number(row.lop);
      case 'sign': return row.withheld ? 'WITHHELD' : '';
      default: return '';
    }
  });
}

/** A total line: the label under Name, amounts elsewhere. */
export function totalValues(cols: PayBillCol[], label: string, totals: Record<string, string>): Array<string | number> {
  return cols.map((c) => (isAmount(c) ? Number(totals[c.key] ?? 0) : c.key === 'name' ? label : ''));
}

export function titleLines(r: PayBillReport) {
  const p = r.period;
  return {
    org: r.organisation.name.toUpperCase(),
    address: r.organisation.address,
    title: `PAY BILL FOR THE MONTH OF ${MONTHS[p.month - 1]!.toUpperCase()} ${p.calendar_year}  (${formatDate(p.from_date)} to ${formatDate(p.to_date)})`,
    meta: `Branch: ${r.branch?.name ?? 'All branches'}     Working days: ${p.working_days ?? '—'}     Employees: ${r.abstract.employees}     Status: ${p.payroll_status}`,
    stamp: r.forApproval ? 'FOR APPROVAL — pending Approve Run' : null,
    generated: `Generated ${new Date(r.generatedAt).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })} by ${r.generatedBy}`,
  };
}

export function payBillFileName(r: PayBillReport, ext: 'pdf' | 'xlsx') {
  const branch = r.branch ? `-${r.branch.name.replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '')}` : '';
  return `pay-bill-${r.period.calendar_year}-${String(r.period.month).padStart(2, '0')}${branch}.${ext}`;
}

export function downloadBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
