import { describe, expect, it } from 'vitest';
import { numberInWords, rupeesInWords } from '../src/lib/amountInWords';
import { buildPayBill, type PayBillSourceLine, type PayBillSourceRow } from '../src/services/payroll/payBill';

describe('rupees in words (Indian system)', () => {
  it.each([
    [0, 'Zero'], [7, 'Seven'], [19, 'Nineteen'], [40, 'Forty'], [101, 'One Hundred One'], [1000, 'One Thousand'],
    [262496, 'Two Lakh Sixty Two Thousand Four Hundred Ninety Six'], [1000000, 'Ten Lakh'], [10000000, 'One Crore'],
    [123456789, 'Twelve Crore Thirty Four Lakh Fifty Six Thousand Seven Hundred Eighty Nine'],
    [1250000000, 'One Hundred Twenty Five Crore'],
  ])('%d', (n, words) => expect(numberInWords(n)).toBe(words));
  it('adds paise and Only', () => {
    expect(rupeesInWords('262496.00')).toBe('Rupees Two Lakh Sixty Two Thousand Four Hundred Ninety Six Only');
    expect(rupeesInWords('1050.5')).toBe('Rupees One Thousand Fifty and Paise Fifty Only');
  });
});

describe('pay bill layout', () => {
  const row = (id: number, branch: [number, string], gross: string, ded: string, o: Partial<PayBillSourceRow> = {}): PayBillSourceRow => ({
    id, employee_code: `E${id}`, employee_name: `Name ${id}`, designation_name: 'Manager', branch_id: branch[0], branch_name: branch[1],
    service_days: 30, payable_days: '28.00', gross_earnings: gross, total_deductions: ded,
    net_salary: (Number(gross) - Number(ded)).toFixed(2), is_withheld: false, withhold_reason: null, ...o,
  });
  const line = (payroll_id: number, code: string, type: number, allowance: string, deduction = '0', name = code, order = 0): PayBillSourceLine => ({
    payroll_id, component_code: code, component_name: name, component_type: type, display_order: order, allowance_amount: allowance, deduction_amount: deduction,
  });
  const HO: [number, string] = [1, 'Head Office'];
  const BR: [number, string] = [2, 'Thiruvarur RO'];
  const rows = [row(1, HO, '1500.00', '600.00'), row(2, HO, '1000.00', '100.00', { is_withheld: true }), row(3, BR, '2000.00', '700.00')];
  const lines = [
    line(1, 'BASIC', 1, '1000'), line(1, 'DA', 1, '300'), line(1, 'EMPLOYER_PF', 1, '200', '200'), line(1, 'PF', 2, '0', '200'),
    line(1, 'IT', 2, '0', '150', 'Income Tax', 220), line(1, 'LIC', 2, '0', '50', 'LIC Premium', 300),
    line(2, 'BASIC', 1, '900'), line(2, 'MA', 1, '100'), line(2, 'PF', 2, '0', '100'),
    line(3, 'basic', 1, '1500'), line(3, 'DA', 1, '300'), line(3, 'EMPLOYER_PF', 1, '200', '200'), line(3, 'PF', 2, '0', '200'),
    line(3, 'LIC', 2, '0', '300', 'LIC Premium', 300), line(3, 'PP', 1, '0'),
  ];
  const bill = buildPayBill(rows, lines);

  it('has a column per component in use, deductions in display order, and none that are zero for everyone', () => {
    expect(bill.columns.map((c) => c.key)).toEqual(['basic', 'da', 'ma', 'employerPfCr', 'pf', 'employerPfDr', 'd:IT', 'd:LIC']);
    expect(bill.columns.find((c) => c.key === 'd:IT')!.label).toBe('I.Tax');
    expect(bill.columns.find((c) => c.key === 'd:LIC')).toMatchObject({ label: 'LIC', name: 'LIC Premium' });
  });

  it('groups by branch in the given order, numbering straight through', () => {
    expect(bill.branches.map((b) => [b.branchName, b.rows.map((r) => r.serial)])).toEqual([['Head Office', [1, 2]], ['Thiruvarur RO', [3]]]);
    expect(bill.branches[0]!.rows[0]).toMatchObject({ payDays: '28', lop: '2', withheld: false });
  });

  it('branch totals add up to the grand total, and every column adds up to gross and deductions', () => {
    for (const k of [...bill.columns.map((c) => c.key), 'gross', 'deductions', 'net'])
      expect(bill.branches.reduce((s, b) => s + Number(b.totals[k]), 0)).toBe(Number(bill.totals[k]));
    for (const b of bill.branches) for (const r of b.rows) {
      const side = (s: string) => bill.columns.filter((c) => c.side === s).reduce((t, c) => t + Number(r.amounts[c.key]), 0);
      expect(side('EARNING')).toBe(Number(r.amounts.gross));
      expect(side('DEDUCTION')).toBe(Number(r.amounts.deductions));
      expect(Number(r.amounts.gross) - Number(r.amounts.deductions)).toBe(Number(r.amounts.net));
    }
    expect(bill.totals).toMatchObject({ basic: '3400.00', gross: '4500.00', deductions: '1400.00', net: '3100.00', 'd:LIC': '350.00' });
  });

  it('abstract: totals, words, branch counts and withheld bills', () => {
    expect(bill.abstract).toMatchObject({
      gross: '4500.00', deductionsTotal: '1400.00', net: '3100.00', netInWords: 'Rupees Three Thousand One Hundred Only', employees: 3,
      byBranch: [{ branchName: 'Head Office', count: 2, net: '1800.00' }, { branchName: 'Thiruvarur RO', count: 1, net: '1300.00' }],
      withheld: { count: 1, net: '900.00' },
    });
    expect(bill.abstract.deductions.map((d) => d.label)).toEqual(['PF', 'Emp PF (Dr)', 'I.Tax', 'LIC']);
    expect(bill.abstract.deductions.map((d) => d.name)).toEqual(['Provident Fund', 'Employer PF Contribution', 'Income Tax', 'LIC Premium']);
  });
});
