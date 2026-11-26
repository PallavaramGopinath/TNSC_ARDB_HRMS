/**
 * Pay Bill print (specs/08 §4.7): every bill of a SALARY period, a column per pay component, grouped by branch
 * with branch totals, a grand total and an abstract. Pure: the service loads the rows, this lays them out.
 *
 * Columns: Basic, PP, GP, SP, DA, HRA, CCA, MA, Emp PF (Cr), Other Earn | PF, Emp PF (Dr), VPF, then one column
 * per other deduction component (Income Tax, agencies, manual) in display order. A column that is zero on every
 * bill of the print is left out.
 */
import { rupeesInWords } from '../../lib/amountInWords';
import { D, toMoneyString, ZERO, type Decimal, type MoneyInput } from '../../lib/money';
import { ComponentCode as C, ComponentType } from '../../models/enums';
import { normaliseCode } from './payrollRules';

/** `label` is the short column heading; `name` the full name, printed in the abstract. */
export interface PayBillColumn { key: string; label: string; name: string; side: 'EARNING' | 'DEDUCTION' }

export interface PayBillSourceRow {
  id: number;
  employee_code: string;
  employee_name: string;
  designation_name: string;
  branch_id: number;
  branch_name: string;
  service_days: string | number | null;
  payable_days: string | null;
  gross_earnings: string;
  total_deductions: string;
  net_salary: string;
  is_withheld: boolean;
  withhold_reason: string | null;
}
export interface PayBillSourceLine {
  payroll_id: number;
  component_code: string;
  component_name: string;
  component_type: number;
  display_order: number | null;
  allowance_amount: string;
  deduction_amount: string;
}

const FIXED_EARNINGS: PayBillColumn[] = [
  { key: 'basic', label: 'Basic', name: 'Basic Pay', side: 'EARNING' },
  { key: 'pp', label: 'PP', name: 'Personal Pay', side: 'EARNING' },
  { key: 'gp', label: 'GP', name: 'Grade Pay', side: 'EARNING' },
  { key: 'sp', label: 'SP', name: 'Special Pay', side: 'EARNING' },
  { key: 'da', label: 'DA', name: 'Dearness Allowance', side: 'EARNING' },
  { key: 'hra', label: 'HRA', name: 'House Rent Allowance', side: 'EARNING' },
  { key: 'cca', label: 'CCA', name: 'City Compensatory Allowance', side: 'EARNING' },
  { key: 'ma', label: 'MA', name: 'Medical Allowance', side: 'EARNING' },
  { key: 'employerPfCr', label: 'Emp PF (Cr)', name: 'Employer PF Contribution', side: 'EARNING' },
  { key: 'otherEarnings', label: 'Other Earn', name: 'Other Earnings', side: 'EARNING' },
];
const FIXED_DEDUCTIONS: PayBillColumn[] = [
  { key: 'pf', label: 'PF', name: 'Provident Fund', side: 'DEDUCTION' },
  { key: 'employerPfDr', label: 'Emp PF (Dr)', name: 'Employer PF Contribution', side: 'DEDUCTION' },
  { key: 'vpf', label: 'VPF', name: 'Additional (Voluntary) PF', side: 'DEDUCTION' },
];
const EARNING_KEY: Record<string, string> = {
  [C.Basic]: 'basic', [C.PersonalPay]: 'pp', [C.GradePay]: 'gp', [C.SpecialPay]: 'sp', [C.DearnessAllowance]: 'da',
  [C.HouseRentAllowance]: 'hra', [C.CityCompensatoryAllowance]: 'cca', [C.MedicalAllowance]: 'ma', [C.EmployerProvidentFund]: 'employerPfCr',
};
const DEDUCTION_KEY: Record<string, string> = { [C.ProvidentFund]: 'pf', [C.EmployerProvidentFund]: 'employerPfDr', [C.VoluntaryProvidentFund]: 'vpf' };
/** Other deductions are headed by their component code (short enough for A4); I.Tax reads better than IT. */
const SHORT: Record<string, string> = { [C.IncomeTax]: 'I.Tax' };

type Sums = Record<string, Decimal>;
const add = (s: Sums, k: string, v: MoneyInput) => { s[k] = (s[k] ?? ZERO).plus(v); };
const money = (s: Sums, keys: string[]) => Object.fromEntries(keys.map((k) => [k, toMoneyString(s[k] ?? ZERO)]));

/** Lay out the pay bill. `rows` must already be in branch order, then payrollPrintOrder within each branch. */
export function buildPayBill(rows: PayBillSourceRow[], lines: PayBillSourceLine[]) {
  const amounts = new Map<number, Sums>();
  const dynamic = new Map<string, { label: string; name: string; order: number }>();
  for (const l of lines) {
    const a = amounts.get(l.payroll_id) ?? {};
    amounts.set(l.payroll_id, a);
    const code = normaliseCode(l.component_code);
    if (D(l.allowance_amount).gt(0) || l.component_type === ComponentType.Earnings) add(a, EARNING_KEY[code] ?? 'otherEarnings', l.allowance_amount);
    if (D(l.deduction_amount).gt(0) || l.component_type !== ComponentType.Earnings) {
      let key = DEDUCTION_KEY[code];
      if (!key) {
        key = `d:${code}`;
        if (!dynamic.has(key)) dynamic.set(key, { label: SHORT[code] ?? l.component_code.trim(), name: l.component_name, order: l.display_order ?? Number.MAX_SAFE_INTEGER });
      }
      add(a, key, l.deduction_amount);
    }
  }

  const allColumns = [
    ...FIXED_EARNINGS,
    ...FIXED_DEDUCTIONS,
    ...[...dynamic].sort(([ka, a], [kb, b]) => a.order - b.order || ka.localeCompare(kb)).map(([key, d]) => ({ key, label: d.label, name: d.name, side: 'DEDUCTION' as const })),
  ];
  const used = (k: string) => rows.some((r) => !(amounts.get(r.id)?.[k] ?? ZERO).isZero());
  const columns = allColumns.filter((c) => used(c.key));
  const keys = [...columns.map((c) => c.key), 'gross', 'deductions', 'net'];

  const total = (list: PayBillSourceRow[]) => {
    const s: Sums = {};
    for (const r of list) {
      for (const c of columns) add(s, c.key, amounts.get(r.id)?.[c.key] ?? ZERO);
      add(s, 'gross', r.gross_earnings);
      add(s, 'deductions', r.total_deductions);
      add(s, 'net', r.net_salary);
    }
    return s;
  };

  let serial = 0;
  const branches: Array<{ branchId: number; branchName: string; rows: ReturnType<typeof line>[]; totals: Record<string, string>; count: number }> = [];
  const line = (r: PayBillSourceRow) => {
    const payable = D(r.payable_days ?? 0);
    return {
      serial: ++serial,
      payrollId: r.id,
      employeeCode: r.employee_code,
      employeeName: r.employee_name,
      designation: r.designation_name,
      payDays: payable.toString(),
      lop: D(r.service_days ?? 0).minus(payable).toString(),
      withheld: r.is_withheld,
      withholdReason: r.withhold_reason,
      amounts: { ...money(amounts.get(r.id) ?? {}, columns.map((c) => c.key)), gross: toMoneyString(D(r.gross_earnings)), deductions: toMoneyString(D(r.total_deductions)), net: toMoneyString(D(r.net_salary)) } as Record<string, string>,
    };
  };
  for (const r of rows) {
    let b = branches[branches.length - 1];
    if (!b || b.branchId !== r.branch_id) {
      b = { branchId: r.branch_id, branchName: r.branch_name, rows: [], totals: {}, count: 0 };
      branches.push(b);
    }
    b.rows.push(line(r));
  }
  for (const b of branches) {
    b.totals = money(total(rows.filter((r) => r.branch_id === b.branchId)), keys);
    b.count = b.rows.length;
  }
  const grand = total(rows);
  const withheld = rows.filter((r) => r.is_withheld);

  return {
    columns,
    branches,
    totals: money(grand, keys),
    abstract: {
      earnings: columns.filter((c) => c.side === 'EARNING').map((c) => ({ label: c.label, name: c.name, amount: toMoneyString(grand[c.key] ?? ZERO) })),
      deductions: columns.filter((c) => c.side === 'DEDUCTION').map((c) => ({ label: c.label, name: c.name, amount: toMoneyString(grand[c.key] ?? ZERO) })),
      gross: toMoneyString(grand.gross ?? ZERO),
      deductionsTotal: toMoneyString(grand.deductions ?? ZERO),
      net: toMoneyString(grand.net ?? ZERO),
      netInWords: rupeesInWords(grand.net ?? ZERO),
      employees: rows.length,
      byBranch: branches.map((b) => ({ branchName: b.branchName, count: b.count, net: b.totals.net! })),
      withheld: { count: withheld.length, net: toMoneyString(withheld.reduce((s, r) => s.plus(r.net_salary), ZERO)) },
    },
  };
}

export type PayBillLayout = ReturnType<typeof buildPayBill>;
