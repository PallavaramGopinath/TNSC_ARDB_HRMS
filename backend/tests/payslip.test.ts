import { describe, expect, it } from 'vitest';
import { buildPayslip, type PayslipSourceLine, type PayslipSourceRow } from '../src/services/payroll/payslip';

// Spec 08 §7.15: June, 30 days, 2 days LOP (cuts SP and DA) and 2 days medical leave at half pay.
const row: PayslipSourceRow = {
  id: 7, employee_id: 3, employee_code: 'E0123', employee_name: 'R. Kumar', designation_name: 'Assistant', grade: 'II', scale_of_pay: '20000-35000',
  epf_number: 'TN/1', pan_number: null, date_of_joining: '2012-07-01', date_of_retirement: '2041-05-31', bank_name: 'Indian Overseas Bank',
  account_number: '123456784521', ifsc_code: 'IOBA0001234', branch_name: 'Head Office', working_days: '30.00', service_days: '30.00', payable_days: '27.00',
  gross_earnings: '56438.00', total_deductions: '13996.00', net_salary: '42442.00', payroll_status: 'DRAFT', is_withheld: false, withhold_reason: null,
  approved_by: null, approved_at: null,
};
const line = (code: string, type: number, allowance: string, deduction = '0', applied: unknown = null, name = code, order: number | null = null): PayslipSourceLine => ({
  payroll_id: 7, component_code: code, component_name: name, component_type: type, display_order: order, allowance_amount: allowance, deduction_amount: deduction, applied,
});
const pf = { rateId: 1, percentage: '12.00', wages: '44980.00' };
const lines = [
  line('PF', 2, '0', '5398', pf), line('EMPLOYER_PF', 1, '5398', '5398', pf),
  line('BASIC', 1, '27000'), line('PP', 1, '270'), line('GP', 1, '2160'), line('SP', 1, '467'),
  line('DA', 1, '15353', '0', { rateId: 4, percentage: '50.00' }),
  line('HRA', 1, '3290', '0', { segments: [{ kind: 'PERCENT', percent: '10.00', minAmount: '1000', maxAmount: '5000', days: 30 }] }),
  line('CCA', 1, '1500', '0', { segments: [{ kind: 'PERCENT', percent: '5', minAmount: '1000', maxAmount: '1500', days: 18 }, { kind: 'FIXED', amount: '400', days: 12 }] }),
  line('MA', 1, '1000'),
  line('SOC', 2, '0', '1000', { assignmentId: 9, uploaded: false }, 'Society', 40),
  line('LIC', 2, '0', '1200', { assignmentId: 8, uploaded: true }, 'LIC Premium', 30),
  line('ADL PF', 3, '0', '1000', { calculated: '800.00' }),
];
const attendance = {
  workingDays: 25, hq: 23, camp: 2, remarks: null,
  leaves: [{ code: 'LOP', name: 'Loss of Pay', days: 2, factor: '1', cutsSpDa: true }, { code: 'ML', name: 'Medical Leave', days: 2, factor: '0.5', cutsSpDa: false }],
};

describe('payslip layout', () => {
  const s = buildPayslip(row, lines, attendance);

  it('orders earnings and deductions, with employer PF on both sides', () => {
    expect(s.earnings.map((e) => e.code)).toEqual(['BASIC', 'PP', 'GP', 'SP', 'DA', 'HRA', 'CCA', 'MA', 'EMPLOYER_PF']);
    expect(s.deductions.map((e) => e.code)).toEqual(['PF', 'EMPLOYER_PF', 'ADL PF', 'LIC', 'SOC']);
    expect(s.earnings.find((e) => e.code === 'EMPLOYER_PF')!.label).toBe('Employer PF (Cr)');
  });

  it('prints the basis of each line', () => {
    const basis = Object.fromEntries([...s.earnings, ...s.deductions].map((e) => [`${e.code}:${e.label}`, e.basis]));
    expect(basis['BASIC:Basic Pay']).toBe('27/30 days');
    expect(basis['SP:Special Pay']).toBe('28/30 days');
    expect(basis['DA:Dearness Allowance']).toBe('50% · 28/30 days');
    expect(basis['HRA:House Rent Allowance']).toBe('10%, 1,000–5,000');
    expect(basis['CCA:City Compensatory Allowance']).toBe('18d: 5%, 1,000–1,500; 12d: Fixed 400');
    expect(basis['MA:Medical Allowance']).toBe('');
    expect(basis['PF:Provident Fund']).toBe('12% of 44,980');
    expect(basis['ADL PF:Additional PF (VPF)']).toBe('Edited (calculated 800)');
    expect(basis['LIC:LIC Premium']).toBe('Amount for the month');
  });

  it('shows attendance, masks the account and puts net pay in words', () => {
    expect(s.attendance).toMatchObject({ calendarDays: 30, workingDays: 25, payDays: 27, lop: 3, hq: 23, camp: 2, entered: true });
    expect(s.attendance.leaves.map((l) => l.code)).toEqual(['LOP', 'ML']);
    expect(s.employee.account).toBe('XXXX4521');
    expect(s.draft).toBe(true);
    expect(s.net).toBe('42442.00');
    expect(s.netInWords).toBe('Rupees Forty Two Thousand Four Hundred Forty Two Only');
  });

  it('works without an attendance entry and once approved', () => {
    const p = buildPayslip({ ...row, payable_days: '30.00', payroll_status: 'APPROVED', approved_by: 'checker', approved_at: '2026-07-01T05:00:00Z' }, lines, null);
    expect(p.draft).toBe(false);
    expect(p.attendance).toMatchObject({ workingDays: null, lop: 0, entered: false });
    expect(p.earnings[0]!.basis).toBe('');
  });
});
