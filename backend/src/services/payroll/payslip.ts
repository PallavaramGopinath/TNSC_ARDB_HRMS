/**
 * Individual pay bill (payslip, specs/08 §4.7): one employee's bill laid out for an A4 portrait page.
 * Earnings and deductions side by side, each line with the basis it was worked out on, read from the rates
 * stored with the line (payroll_details.applied) and the month's attendance. Pure: the service loads the rows.
 */
import { rupeesInWords } from '../../lib/amountInWords';
import { D, toMoneyString, ZERO } from '../../lib/money';
import { ComponentCode as C } from '../../models/enums';
import { normaliseCode } from './payrollRules';

export interface PayslipSourceRow {
  id: number;
  employee_id: number;
  employee_code: string;
  employee_name: string;
  designation_name: string;
  grade: string | null;
  scale_of_pay: string | null;
  epf_number: string | null;
  pan_number: string | null;
  date_of_joining: string | null;
  date_of_retirement: string | null;
  bank_name: string | null;
  account_number: string | null;
  ifsc_code: string | null;
  branch_name: string;
  working_days: string | number | null;
  service_days: string | number | null;
  payable_days: string | null;
  gross_earnings: string;
  total_deductions: string;
  net_salary: string;
  payroll_status: string;
  is_withheld: boolean;
  withhold_reason: string | null;
  approved_by: string | null;
  approved_at: string | Date | null;
}
export interface PayslipSourceLine {
  payroll_id: number;
  component_code: string;
  component_name: string;
  component_type: number;
  display_order: number | null;
  allowance_amount: string;
  deduction_amount: string;
  applied: unknown;
}
export interface PayslipAttendance {
  workingDays: number;
  hq: number;
  camp: number;
  remarks: string | null;
  leaves: Array<{ code: string; name: string; days: number; factor: string; cutsSpDa: boolean }>;
}

const EARNING_ORDER = [C.Basic, C.PersonalPay, C.GradePay, C.SpecialPay, C.DearnessAllowance, C.HouseRentAllowance, C.CityCompensatoryAllowance, C.MedicalAllowance, C.EmployerProvidentFund];
const DEDUCTION_ORDER = [C.ProvidentFund, C.EmployerProvidentFund, C.VoluntaryProvidentFund];
const LABEL: Record<string, string> = {
  [C.Basic]: 'Basic Pay', [C.PersonalPay]: 'Personal Pay', [C.GradePay]: 'Grade Pay', [C.SpecialPay]: 'Special Pay', [C.DearnessAllowance]: 'Dearness Allowance',
  [C.HouseRentAllowance]: 'House Rent Allowance', [C.CityCompensatoryAllowance]: 'City Compensatory Allowance', [C.MedicalAllowance]: 'Medical Allowance',
  [C.ProvidentFund]: 'Provident Fund', [C.VoluntaryProvidentFund]: 'Additional PF (VPF)',
};

const inr = (v: string | number) => D(v).toNumber().toLocaleString('en-IN', { maximumFractionDigits: 2 });
const pct = (v: unknown) => `${D(String(v)).toNumber()}%`;
const days = (n: number | string) => D(n).toNumber().toString();
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' ? (v as Record<string, unknown>) : {});

/** "10%, 1,000–5,000" / "Fixed 1,000", and the days when the month is split. */
function segmentsBasis(applied: unknown): string {
  const segs = obj(applied).segments;
  if (!Array.isArray(segs) || segs.length === 0) return '';
  const one = (s: Record<string, unknown>) => {
    if (s.kind === 'FIXED') return `Fixed ${inr(String(s.amount))}`;
    if (s.kind !== 'PERCENT') return '';
    const min = D(String(s.minAmount ?? 0));
    const max = D(String(s.maxAmount ?? 0));
    const range = min.gt(0) && max.gt(0) ? `, ${inr(min.toString())}–${inr(max.toString())}` : max.gt(0) ? `, max ${inr(max.toString())}` : min.gt(0) ? `, min ${inr(min.toString())}` : '';
    return `${pct(s.percent)}${range}`;
  };
  const parts = segs.map((s) => obj(s)).filter((s) => s.kind !== undefined);
  if (parts.length === 1) return one(parts[0]!);
  return parts.map((s) => `${days(String(s.days))}d: ${one(s) || '—'}`).join('; ');
}

/** Lay out one payslip. `lines` are the bill's lines only. */
export function buildPayslip(row: PayslipSourceRow, lines: PayslipSourceLine[], attendance: PayslipAttendance | null) {
  const calendar = D(row.working_days ?? 0);
  const served = D(row.service_days ?? calendar);
  const payDays = D(row.payable_days ?? served);
  const spDaUnpaid = (attendance?.leaves ?? []).filter((l) => l.cutsSpDa).reduce((s, l) => s.plus(D(l.factor).times(l.days)), ZERO);
  const spDaDays = served.minus(spDaUnpaid.gt(served) ? served : spDaUnpaid);
  const ofDays = (n: typeof calendar) => (n.lt(calendar) ? `${days(n.toString())}/${days(calendar.toString())} days` : '');

  const basis = (code: string, side: 'EARNING' | 'DEDUCTION', applied: unknown): string => {
    const a = obj(applied);
    if (a.calculated !== undefined) return `Edited (calculated ${inr(String(a.calculated))})`;
    switch (code) {
      case C.Basic: case C.PersonalPay: case C.GradePay: return ofDays(payDays);
      case C.SpecialPay: return ofDays(spDaDays);
      case C.DearnessAllowance: return [a.percentage !== undefined ? pct(a.percentage) : '', ofDays(spDaDays)].filter(Boolean).join(' · ');
      case C.HouseRentAllowance: case C.CityCompensatoryAllowance: return segmentsBasis(applied);
      case C.MedicalAllowance: return ofDays(served);
      case C.ProvidentFund: return a.percentage !== undefined ? `${pct(a.percentage)} of ${inr(String(a.wages ?? 0))}` : '';
      case C.EmployerProvidentFund: return side === 'EARNING' ? 'Employer contribution' : 'Equal to PF';
      default: return a.uploaded === true ? 'Amount for the month' : '';
    }
  };

  type Item = { code: string; label: string; basis: string; amount: string; order: number };
  const earnings: Item[] = [];
  const deductions: Item[] = [];
  const rank = (list: readonly string[], code: string, display: number | null) => {
    const i = list.indexOf(code);
    return i >= 0 ? i : 1000 + (display ?? 100_000);
  };
  for (const l of lines) {
    const code = normaliseCode(l.component_code);
    const name = LABEL[code] ?? l.component_name;
    if (!D(l.allowance_amount).isZero())
      earnings.push({ code, label: code === C.EmployerProvidentFund ? 'Employer PF (Cr)' : name, basis: basis(code, 'EARNING', l.applied), amount: toMoneyString(D(l.allowance_amount)), order: rank(EARNING_ORDER, code, l.display_order) });
    if (!D(l.deduction_amount).isZero())
      deductions.push({ code, label: code === C.EmployerProvidentFund ? 'Employer PF (Dr)' : name, basis: basis(code, 'DEDUCTION', l.applied), amount: toMoneyString(D(l.deduction_amount)), order: rank(DEDUCTION_ORDER, code, l.display_order) });
  }
  const sorted = (list: Item[]) => list.sort((a, b) => a.order - b.order || a.label.localeCompare(b.label)).map(({ order: _o, ...i }) => i);

  const account = row.account_number?.trim();
  return {
    payrollId: row.id,
    employeeId: row.employee_id,
    status: row.payroll_status,
    draft: row.payroll_status === 'DRAFT',
    withheld: row.is_withheld,
    withholdReason: row.withhold_reason,
    approvedBy: row.approved_by,
    approvedAt: row.approved_at ? new Date(row.approved_at).toISOString() : null,
    employee: {
      code: row.employee_code,
      name: row.employee_name,
      designation: row.designation_name,
      grade: row.grade,
      scaleOfPay: row.scale_of_pay,
      branch: row.branch_name,
      epfNumber: row.epf_number,
      pan: row.pan_number,
      dateOfJoining: row.date_of_joining,
      dateOfRetirement: row.date_of_retirement,
      bank: row.bank_name,
      /** Last four digits only: the slip is handed out and filed. */
      account: account ? `XXXX${account.slice(-4)}` : null,
      ifsc: row.ifsc_code,
    },
    attendance: {
      calendarDays: calendar.toNumber(),
      workingDays: attendance?.workingDays ?? null,
      serviceDays: served.toNumber(),
      payDays: payDays.toNumber(),
      lop: served.minus(payDays).toNumber(),
      hq: attendance?.hq ?? null,
      camp: attendance?.camp ?? null,
      remarks: attendance?.remarks ?? null,
      leaves: (attendance?.leaves ?? []).filter((l) => l.days > 0).map((l) => ({ code: l.code, name: l.name, days: l.days })),
      entered: attendance !== null,
    },
    earnings: sorted(earnings),
    deductions: sorted(deductions),
    gross: toMoneyString(D(row.gross_earnings)),
    deductionsTotal: toMoneyString(D(row.total_deductions)),
    net: toMoneyString(D(row.net_salary)),
    netInWords: rupeesInWords(row.net_salary),
  };
}

export type PayslipLayout = ReturnType<typeof buildPayslip>;
