/**
 * Pay Bill as an A4 landscape PDF: a page (or more) per branch with its total, the grand total, then the abstract.
 * jsPDF is loaded only when a PDF is asked for.
 */
import type { PayBillReport } from '@/types/api';
import { abstractLabel, cellMoney, money, payBillColumns, payBillFileName, rowValues, titleLines, totalValues, type PayBillCol } from './payBill';

const MARGIN = 8;
const TOP = 30;
const PAD = 0.7;
const NAME_WIDTH = 34;
const SIGN_WIDTH = 14;

export async function payBillPdf(r: PayBillReport): Promise<{ blob: Blob; name: string }> {
  const [{ jsPDF }, { autoTable }] = await Promise.all([import('jspdf'), import('jspdf-autotable')]);
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const t = titleLines(r);
  const cols = payBillColumns(r);

  const header = () => {
    doc.setTextColor(20);
    doc.setFont('helvetica', 'bold').setFontSize(11).text(t.org, W / 2, 11, { align: 'center' });
    doc.setFont('helvetica', 'normal').setFontSize(8);
    if (t.address) doc.text(t.address, W / 2, 15, { align: 'center' });
    doc.setFont('helvetica', 'bold').setFontSize(9.5).text(t.title, W / 2, 20, { align: 'center' });
    doc.setFont('helvetica', 'normal').setFontSize(7.5).text(t.meta, MARGIN, 26);
    if (t.stamp) {
      doc.setTextColor(200, 30, 30).setFont('helvetica', 'bold').setFontSize(9);
      doc.text(`*** ${t.stamp.replace('—', '-')} ***`, W - MARGIN, 26, { align: 'right' });
      doc.setTextColor(20);
    }
  };

  const amountCol = (c: PayBillCol) => c.kind === 'amount' || c.kind === 'total';
  const cell = (v: string | number, c: PayBillCol) => (typeof v === 'number' && amountCol(c) ? cellMoney(v) : String(v));

  // Fit every column to its widest figure, at the largest font (6.5pt down to 4.5pt) that fits A4 landscape.
  const allRows = r.branches.flatMap((b) => [...b.rows.map((row) => rowValues(cols, row)), totalValues(cols, '', b.totals)]);
  allRows.push(totalValues(cols, '', r.totals));
  const fit = (size: number) => {
    doc.setFontSize(size);
    return cols.map((c, i) => {
      if (c.key === 'name') return NAME_WIDTH;
      if (c.key === 'sign') return SIGN_WIDTH;
      doc.setFont('helvetica', 'bold');
      const head = Math.max(...c.label.split(' ').map((w) => doc.getTextWidth(w)));
      const body = Math.max(0, ...allRows.map((v) => doc.getTextWidth(cell(v[i]!, c))));
      return Math.max(head, body) + PAD * 2 + 0.3;
    });
  };
  const avail = W - MARGIN * 2;
  let fontSize = 6.5;
  let widths = fit(fontSize);
  while (widths.reduce((a, b) => a + b, 0) > avail && fontSize > 4.5) widths = fit((fontSize -= 0.25));
  const spare = avail - widths.reduce((a, b) => a + b, 0);
  const amountCount = cols.filter(amountCol).length;
  if (spare > 0) widths = widths.map((w, i) => (amountCol(cols[i]!) ? w + spare / amountCount : w));
  doc.setFont('helvetica', 'normal');

  const columnStyles = Object.fromEntries(
    cols.map((c, i) => [i, {
      cellWidth: widths[i]!,
      halign: amountCol(c) || c.kind === 'days' ? ('right' as const) : ('left' as const),
      fontStyle: c.kind === 'total' ? ('bold' as const) : ('normal' as const),
    }]),
  );
  const base = {
    margin: { top: TOP, left: MARGIN, right: MARGIN, bottom: 12 },
    theme: 'grid' as const,
    styles: { font: 'helvetica', fontSize, cellPadding: PAD, lineColor: 150, lineWidth: 0.1, textColor: 20, overflow: 'linebreak' as const, valign: 'middle' as const },
    headStyles: { fillColor: 235, textColor: 20, fontStyle: 'bold' as const, halign: 'center' as const, fontSize },
    didDrawPage: header,
  };

  r.branches.forEach((b, n) => {
    if (n > 0) doc.addPage();
    const body = [
      [{ content: `BRANCH: ${b.branchName.toUpperCase()}  (${b.count})`, colSpan: cols.length, styles: { fontStyle: 'bold' as const, fillColor: 245 } }],
      ...b.rows.map((row) => rowValues(cols, row).map((v, i) => ({
        content: cell(v, cols[i]!),
        styles: cols[i]!.key === 'sign' && row.withheld ? { textColor: [200, 30, 30] as [number, number, number], fontStyle: 'bold' as const } : {},
      }))),
      totalValues(cols, `${b.branchName} Total`, b.totals).map((v, i) => ({ content: cell(v, cols[i]!), styles: { fontStyle: 'bold' as const, fillColor: 245 } })),
    ];
    if (n === r.branches.length - 1)
      body.push(totalValues(cols, `GRAND TOTAL (${r.abstract.employees})`, r.totals).map((v, i) => ({ content: cell(v, cols[i]!), styles: { fontStyle: 'bold' as const, fillColor: 225 } })));
    autoTable(doc, { ...base, tableWidth: avail, head: [cols.map((c) => c.label)], body, columnStyles, rowPageBreak: 'avoid' });
  });

  // Abstract
  doc.addPage();
  const a = r.abstract;
  const half = (W - MARGIN * 2 - 10) / 2;
  const lastY = () => (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY;
  const small = { ...base.styles, fontSize: 7.5, cellPadding: 0.9 };
  const smallHead = { ...base.headStyles, fontSize: 7.5, halign: 'left' as const };
  const smallFoot = { fillColor: 235, textColor: 20, fontStyle: 'bold' as const };
  const side = (title: string, items: Array<{ label: string; name: string; amount: string }>, total: [string, string], x: number) =>
    autoTable(doc, {
      ...base, startY: TOP + 7, margin: { ...base.margin, left: x }, tableWidth: half, styles: small, headStyles: smallHead,
      head: [[title, 'Amount (Rs.)']],
      body: items.map((i) => [abstractLabel(i), money(i.amount)]),
      foot: [total], showFoot: 'lastPage', footStyles: { ...smallFoot, halign: 'right' },
      columnStyles: { 1: { halign: 'right' } },
    });
  doc.setFont('helvetica', 'bold').setFontSize(10).text('ABSTRACT', W / 2, TOP + 3, { align: 'center' });
  side('Earnings', a.earnings, ['GROSS', money(a.gross)], MARGIN);
  const leftEnd = lastY();
  side('Deductions', a.deductions, ['TOTAL DEDUCTIONS', money(a.deductionsTotal)], MARGIN + half + 10);
  let y = Math.max(leftEnd, lastY()) + 7;

  doc.setFont('helvetica', 'bold').setFontSize(10).text(`NET PAY: Rs. ${money(a.net)}`, MARGIN, y);
  doc.setFont('helvetica', 'normal').setFontSize(9).text(`(${a.netInWords})`, MARGIN, y + 5, { maxWidth: W - MARGIN * 2 });
  y += 10;

  // Employees and net pay by branch, in three side-by-side columns so ~30 branches fit under the totals.
  const entries = [
    ...a.byBranch.map((b) => [b.branchName, String(b.count), money(b.net)]),
    ...(a.withheld.count ? [['Of which withheld', String(a.withheld.count), money(a.withheld.net)]] : []),
  ];
  const per = Math.ceil(entries.length / 3);
  const body = Array.from({ length: per }, (_, i) => [0, 1, 2].flatMap((k) => entries[k * per + i] ?? ['', '', '']));
  const right = { halign: 'right' as const };
  // Keep the summary on one page with the signatures: start a page when it would not fit under the totals.
  if (y + (per + 2) * 4.3 > H - 40) { doc.addPage(); y = TOP + 3; }
  autoTable(doc, {
    ...base, startY: y, tableWidth: avail, styles: { ...small, fontSize: 7 }, headStyles: { ...smallHead, fontSize: 7 },
    head: [['Branch', 'Emp.', 'Net Pay (Rs.)', 'Branch', 'Emp.', 'Net Pay (Rs.)', 'Branch', 'Emp.', 'Net Pay (Rs.)']],
    body,
    foot: [[{ content: 'Total', colSpan: 7 }, { content: String(a.employees), styles: right }, { content: money(a.net), styles: right }]], showFoot: 'lastPage', footStyles: smallFoot,
    columnStyles: { 1: right, 2: right, 4: right, 5: right, 7: right, 8: right },
  });
  y = Math.max(lastY() + 20, H - 28);
  if (y > H - 14) { doc.addPage(); y = TOP + 30; }
  const third = (W - MARGIN * 2) / 3;
  doc.setFont('helvetica', 'normal').setFontSize(9);
  ['Prepared by', 'Checked by', 'Approved by'].forEach((s, i) => {
    const x = MARGIN + third * i + 10;
    doc.line(x, y, x + third - 30, y);
    doc.text(s, x, y + 5);
  });

  // Footer on every page
  const pages = doc.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);
    doc.setFont('helvetica', 'normal').setFontSize(7).setTextColor(90);
    doc.text(t.generated, MARGIN, H - 5);
    doc.text(`Page ${i} of ${pages}`, W - MARGIN, H - 5, { align: 'right' });
  }
  return { blob: doc.output('blob'), name: payBillFileName(r, 'pdf') };
}
