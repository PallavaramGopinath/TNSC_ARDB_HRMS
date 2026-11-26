import { payrollApi } from '@/services/payroll';
import { downloadBlob } from './payBill';

/**
 * Payslips as a PDF in a new tab (one employee, a branch, or all). The tab is opened before the slow part,
 * while the click still counts as the user's, so a popup blocker does not stop it; if it does, the PDF is downloaded.
 */
export async function openPayslips(periodId: number, opts: { employeeId?: number; branchId?: number }) {
  const tab = window.open('', '_blank');
  try {
    const report = await payrollApi.preparation.payslips(periodId, opts);
    const { blob, name } = await (await import('./payslipPdf')).payslipPdf(report);
    const url = URL.createObjectURL(blob);
    if (tab) tab.location.href = url;
    else downloadBlob(blob, name);
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  } catch (e) {
    tab?.close();
    throw e;
  }
}
