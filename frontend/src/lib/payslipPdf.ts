/**
 * Individual pay bill (payslip, specs/08 §4.7) as an A4 portrait PDF, one employee per page:
 * header, employee, attendance, earnings | deductions with their basis, net pay in words, sign-off.
 * A bill not yet approved or paid carries a DRAFT watermark. jsPDF is loaded only when a PDF is asked for.
 */
import type { Payslip, PayslipReport } from '@/types/api';
import { formatDate, MONTHS } from './format';
import { money } from './payBill';

const M = 12;
type RGB = [number, number, number];
const RED: RGB = [200, 30, 30];

const when = (iso: string) => new Date(iso).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });
const dash = (v: string | number | null | undefined) => (v === null || v === undefined || v === '' ? '—' : String(v));

export function payslipFileName(r: PayslipReport) {
  const ym = `${r.period.calendar_year}-${String(r.period.month).padStart(2, '0')}`;
  return r.slips.length === 1 ? `payslip-${ym}-${r.slips[0]!.employee.code.replace(/[^A-Za-z0-9]+/g, '-')}.pdf` : `payslips-${ym}.pdf`;
}

function statusLine(s: Payslip) {
  if (s.status === 'PAID') return 'Status: Paid';
  if (s.status === 'APPROVED') return `Status: Approved${s.approvedBy ? ` by ${s.approvedBy}` : ''}${s.approvedAt ? ` on ${formatDate(s.approvedAt)}` : ''}`;
  return 'Status: DRAFT - pending Approve Run';
}

export async function payslipPdf(r: PayslipReport): Promise<{ blob: Blob; name: string }> {
  const [{ jsPDF }, { autoTable }] = await Promise.all([import('jspdf'), import('jspdf-autotable')]);
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const inner = W - M * 2;
  const lastY = () => (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY;
  const p = r.period;
  const month = `${MONTHS[p.month - 1]!.toUpperCase()} ${p.calendar_year}`;

  const grid = {
    theme: 'grid' as const,
    margin: { left: M, right: M },
    styles: { font: 'helvetica', fontSize: 8.5, cellPadding: 1.2, lineColor: 150, lineWidth: 0.15, textColor: 20, valign: 'middle' as const },
    headStyles: { fillColor: 235, textColor: 20, fontStyle: 'bold' as const },
  };
  const label = { textColor: 90 };
  const section = (title: string, y: number) => {
    doc.setFont('helvetica', 'bold').setFontSize(9).setTextColor(20).text(title, M, y);
    return y + 1.5;
  };

  r.slips.forEach((s, n) => {
    if (n > 0) doc.addPage();
    const e = s.employee;
    const a = s.attendance;

    // ---- header
    doc.setTextColor(20).setFont('helvetica', 'bold').setFontSize(13).text(r.organisation.name.toUpperCase(), W / 2, 16, { align: 'center' });
    doc.setFont('helvetica', 'normal').setFontSize(8.5);
    if (r.organisation.address) doc.text(r.organisation.address, W / 2, 21, { align: 'center' });
    doc.text(e.branch, W / 2, r.organisation.address ? 25 : 21, { align: 'center' });
    doc.setFont('helvetica', 'bold').setFontSize(11).text(`PAY BILL - INDIVIDUAL  :  ${month}`, W / 2, 32, { align: 'center' });
    doc.setFont('helvetica', 'normal').setFontSize(8).text(`Period ${formatDate(p.from_date)} to ${formatDate(p.to_date)}`, M, 38);
    if (s.draft) doc.setTextColor(...RED).setFont('helvetica', 'bold');
    doc.text(statusLine(s), W - M, 38, { align: 'right' });
    doc.setTextColor(20).setFont('helvetica', 'normal');

    // ---- employee
    let y = section('Employee', 45);
    autoTable(doc, {
      ...grid, startY: y,
      columnStyles: { 0: { ...label, cellWidth: 24 }, 2: { ...label, cellWidth: 22 }, 4: { ...label, cellWidth: 20 } },
      body: [
        ['Code', e.code, 'Name', { content: e.name, colSpan: 3, styles: { fontStyle: 'bold' } }],
        ['Designation', e.designation, 'Grade', dash(e.grade), 'Branch', e.branch],
        ['Scale of pay', { content: dash(e.scaleOfPay), colSpan: 3 }, 'EPF no.', dash(e.epfNumber)],
        ['Date of joining', formatDate(e.dateOfJoining), 'Retires on', formatDate(e.dateOfRetirement), 'PAN', dash(e.pan)],
        ['Bank', { content: e.bank ? `${e.bank}${e.account ? `  A/c ${e.account}` : ''}` : dash(e.account), colSpan: 3 }, 'IFSC', dash(e.ifsc)],
      ],
    });

    // ---- attendance
    y = section('Attendance', lastY() + 7);
    const leaves = a.leaves.map((l) => [l.code, String(l.days)] as const);
    autoTable(doc, {
      ...grid, startY: y,
      styles: { ...grid.styles, halign: 'center' },
      head: [['Calendar days', 'Working days', 'Pay days', 'Unpaid days', ...leaves.map(([c]) => c), 'HQ / Camp']],
      body: [[String(a.calendarDays), dash(a.workingDays ?? p.working_days), String(a.payDays), a.lop ? String(a.lop) : '-', ...leaves.map(([, d]) => d), a.entered ? `${a.hq} / ${a.camp}` : '-']],
    });
    if (!a.entered) {
      doc.setFont('helvetica', 'italic').setFontSize(7.5).setTextColor(90).text('No attendance entry: paid in full.', M, lastY() + 3.5);
      doc.setTextColor(20);
    }

    // ---- earnings | deductions: one table, so the two sides always stay in line
    y = section('Earnings and deductions', lastY() + (a.entered ? 7 : 10));
    const rows = Math.max(s.earnings.length, s.deductions.length);
    const cells = (l: (typeof s.earnings)[number] | undefined) => (l ? [l.label, l.basis, money(l.amount)] : [' ', '', '']);
    const amountW = 17;
    const labelW = 34;
    const basisW = inner / 2 - labelW - amountW;
    autoTable(doc, {
      ...grid, startY: y,
      styles: { ...grid.styles, fontSize: 8, overflow: 'linebreak' },
      head: [['Earnings', 'Basis', 'Rs.', 'Deductions', 'Basis', 'Rs.']],
      body: Array.from({ length: rows }, (_, i) => [...cells(s.earnings[i]), ...cells(s.deductions[i])]),
      foot: [[{ content: 'Gross', colSpan: 2 }, money(s.gross), { content: 'Total deductions', colSpan: 2 }, money(s.deductionsTotal)]],
      footStyles: { fillColor: 235, textColor: 20, fontStyle: 'bold' },
      columnStyles: {
        0: { cellWidth: labelW }, 1: { cellWidth: basisW, textColor: 90, fontSize: 7 }, 2: { cellWidth: amountW, halign: 'right' },
        3: { cellWidth: labelW }, 4: { cellWidth: basisW, textColor: 90, fontSize: 7 }, 5: { cellWidth: amountW, halign: 'right' },
      },
      didParseCell: (c) => { if ((c.column.index === 2 || c.column.index === 5) && c.section !== 'body') c.cell.styles.halign = 'right'; },
      // A heavier rule between the two sides.
      didDrawCell: (c) => {
        if (c.column.index !== 3) return;
        doc.setLineWidth(0.5).setDrawColor(40).line(c.cell.x, c.cell.y, c.cell.x, c.cell.y + c.cell.height);
        doc.setLineWidth(0.15).setDrawColor(150);
      },
    });
    y = lastY() + 5;

    // ---- net pay
    doc.setLineWidth(0.5).setDrawColor(40).rect(M, y, inner, 14);
    doc.setFont('helvetica', 'bold').setFontSize(11).text(`NET PAY:  Rs. ${money(s.net)}`, M + 3, y + 6);
    doc.setFont('helvetica', 'normal').setFontSize(8.5).text(`(${s.netInWords})`, M + 3, y + 11, { maxWidth: inner - 6 });
    y += 14;
    if (s.withheld) {
      doc.setTextColor(...RED).setFont('helvetica', 'bold').setFontSize(9)
        .text(`WITHHELD${s.withholdReason ? ` - ${s.withholdReason}` : ''}: not part of the bulk payment.`, M, y + 5, { maxWidth: inner });
      doc.setTextColor(20);
      y += 6;
    }
    if (a.remarks) {
      doc.setFont('helvetica', 'normal').setFontSize(8).setTextColor(90).text(`Remarks: ${a.remarks}`, M, y + 5, { maxWidth: inner });
      doc.setTextColor(20);
    }

    // ---- sign-off, at the foot of the page
    const sy = Math.max(y + 28, H - 34);
    const quarter = inner / 4;
    const signs: Array<[string, string]> = [
      ['Prepared by', r.preparedBy ?? ''],
      ['Checked by', ''],
      ['Approved by', s.approvedBy ? `${s.approvedBy}${s.approvedAt ? `, ${formatDate(s.approvedAt)}` : ''}` : ''],
      ['Received by employee', ''],
    ];
    doc.setLineWidth(0.2).setDrawColor(80);
    signs.forEach(([title, who], i) => {
      const x = M + quarter * i + 3;
      const w = quarter - 6;
      if (who) doc.setFont('helvetica', 'normal').setFontSize(7.5).text(who, x + w / 2, sy - 1.5, { align: 'center', maxWidth: w });
      doc.line(x, sy, x + w, sy);
      doc.setFont('helvetica', 'normal').setFontSize(8.5).text(title, x + w / 2, sy + 4.5, { align: 'center' });
    });

    // ---- DRAFT watermark over the page
    if (s.draft) {
      const g = doc as unknown as { GState: new (o: { opacity: number }) => unknown; setGState: (g: unknown) => void };
      g.setGState(new g.GState({ opacity: 0.12 }));
      doc.setTextColor(...RED).setFont('helvetica', 'bold').setFontSize(110).text('DRAFT', W / 2 - 55, H / 2 + 45, { angle: 45 });
      g.setGState(new g.GState({ opacity: 1 }));
      doc.setTextColor(20);
    }
  });

  // ---- footer on every page
  const pages = doc.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);
    doc.setFont('helvetica', 'normal').setFontSize(7).setTextColor(90);
    doc.text(`Generated ${when(r.generatedAt)} by ${r.generatedBy}. Computer-generated.`, M, H - 8);
    doc.text(`Page ${i} of ${pages}`, W - M, H - 8, { align: 'right' });
  }
  return { blob: doc.output('blob'), name: payslipFileName(r) };
}
