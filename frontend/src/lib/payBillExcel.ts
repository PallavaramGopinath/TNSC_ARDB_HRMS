/** Pay Bill as an .xlsx workbook: sheet "Pay Bill" (branch sections, totals) and sheet "Abstract". Amounts are numbers. */
import type { PayBillReport } from '@/types/api';
import { abstractLabel, downloadBlob, payBillColumns, payBillFileName, rowValues, titleLines, totalValues } from './payBill';

const AMOUNT = '#,##,##0.00';
/** Pay bill cells: blank for zero, like the print. */
const CELL = '#,##,##0.00;-#,##,##0.00;""';

export async function downloadPayBillExcel(r: PayBillReport) {
  const Excel = await import('exceljs').then((m) => m.default ?? m);
  const book = new Excel.Workbook();
  const t = titleLines(r);
  const cols = payBillColumns(r);
  const last = cols.length;

  const sheet = book.addWorksheet('Pay Bill', { pageSetup: { paperSize: 9, orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 } });
  const title = (text: string, size: number, bold = true, color?: string) => {
    const row = sheet.addRow([text]);
    sheet.mergeCells(row.number, 1, row.number, last);
    row.getCell(1).font = { bold, size, ...(color ? { color: { argb: color } } : {}) };
    row.getCell(1).alignment = { horizontal: 'center' };
  };
  title(t.org, 13);
  if (t.address) title(t.address, 10, false);
  title(t.title, 11);
  title(t.meta, 9, false);
  if (t.stamp) title(`*** ${t.stamp} ***`, 10, true, 'FFC81E1E');

  const head = sheet.addRow(cols.map((c) => c.label));
  head.eachCell((c) => {
    c.font = { bold: true };
    c.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEBEBEB' } };
  });
  sheet.views = [{ state: 'frozen', ySplit: head.number, xSplit: 3 }];
  sheet.pageSetup.printTitlesRow = `${head.number}:${head.number}`;

  const amountIdx = cols.map((c, i) => (c.kind === 'amount' || c.kind === 'total' ? i + 1 : 0)).filter(Boolean);
  const style = (row: ReturnType<typeof sheet.addRow>, bold = false, fill?: string) => {
    for (const i of amountIdx) row.getCell(i).numFmt = CELL;
    row.eachCell({ includeEmpty: true }, (c) => {
      c.border = { top: { style: 'thin' }, bottom: { style: 'thin' }, left: { style: 'thin' }, right: { style: 'thin' } };
      if (bold) c.font = { bold: true };
      if (fill) c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: fill } };
    });
  };
  for (const b of r.branches) {
    const h = sheet.addRow([`BRANCH: ${b.branchName.toUpperCase()}  (${b.count})`]);
    sheet.mergeCells(h.number, 1, h.number, last);
    h.getCell(1).font = { bold: true };
    h.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF5F5F5' } };
    for (const row of b.rows) {
      const x = sheet.addRow(rowValues(cols, row).map((v, i) => (cols[i]!.key === 'name' ? String(v).replace('\n', ' — ') : v)));
      style(x);
      if (row.withheld) x.getCell(last).font = { bold: true, color: { argb: 'FFC81E1E' } };
    }
    style(sheet.addRow(totalValues(cols, `${b.branchName} Total`, b.totals)), true, 'FFF5F5F5');
  }
  style(sheet.addRow(totalValues(cols, `GRAND TOTAL (${r.abstract.employees})`, r.totals)), true, 'FFE1E1E1');
  sheet.addRow([]);
  sheet.addRow([t.generated]).getCell(1).font = { italic: true, size: 8 };

  cols.forEach((c, i) => {
    sheet.getColumn(i + 1).width = c.key === 'serial' ? 6 : c.key === 'code' ? 9 : c.key === 'name' ? 42 : c.key === 'sign' ? 16 : c.kind === 'days' ? 8 : 13;
  });

  // Abstract
  const a = r.abstract;
  const ab = book.addWorksheet('Abstract', { pageSetup: { paperSize: 9, orientation: 'portrait', fitToPage: true, fitToWidth: 1, fitToHeight: 0 } });
  ab.columns = [{ width: 32 }, { width: 18 }, { width: 4 }, { width: 32 }, { width: 18 }];
  const add = (values: Array<string | number | null>, bold = false, amounts = [2, 5]) => {
    const row = ab.addRow(values);
    if (bold) row.font = { bold: true };
    for (const i of amounts) row.getCell(i).numFmt = AMOUNT;
    return row;
  };
  add([t.org], true);
  add([t.title], true);
  if (t.stamp) ab.addRow([`*** ${t.stamp} ***`]).getCell(1).font = { bold: true, color: { argb: 'FFC81E1E' } };
  add([]);
  add(['ABSTRACT'], true);
  add(['Earnings', 'Amount', null, 'Deductions', 'Amount'], true);
  for (let i = 0; i < Math.max(a.earnings.length, a.deductions.length); i++) {
    const e = a.earnings[i];
    const d = a.deductions[i];
    add([e ? abstractLabel(e) : null, e ? Number(e.amount) : null, null, d ? abstractLabel(d) : null, d ? Number(d.amount) : null]);
  }
  add(['GROSS', Number(a.gross), null, 'TOTAL DEDUCTIONS', Number(a.deductionsTotal)], true);
  add([]);
  add(['NET PAY', Number(a.net)], true);
  add([a.netInWords]);
  add([]);
  add(['Branch', 'Employees', null, 'Net Pay'], true);
  for (const b of a.byBranch) add([b.branchName, b.count, null, Number(b.net)], false, [4]);
  if (a.withheld.count) add(['Of which withheld', a.withheld.count, null, Number(a.withheld.net)], false, [4]);
  add(['Total', a.employees, null, Number(a.net)], true, [4]);
  add([]);
  add([]);
  add(['Prepared by', null, null, 'Checked by']);
  add([]);
  add(['Approved by']);

  const blob = new Blob([await book.xlsx.writeBuffer()], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  downloadBlob(blob, payBillFileName(r, 'xlsx'));
}
