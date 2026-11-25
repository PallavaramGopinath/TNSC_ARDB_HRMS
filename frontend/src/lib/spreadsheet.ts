/** Reading and writing .xlsx and .csv in the browser. The Excel library is loaded only when it is needed. */
import type { CellValue } from 'exceljs';
import { downloadText, parseCsv, toCsv } from './csv';

export type Cell = string | number | null;
export type SheetFormat = 'xlsx' | 'csv';
const MAX_BYTES = 5 * 1024 * 1024;

const loadExcel = () => import('exceljs').then((m) => m.default ?? m);

function cellText(v: CellValue): string {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === 'object') {
    if ('richText' in v) return v.richText.map((t) => t.text).join('');
    if ('result' in v || 'formula' in v || 'sharedFormula' in v) return cellText((v as { result?: CellValue }).result ?? null);
    if ('text' in v) return String(v.text);
    return '';
  }
  return String(v);
}

/** First sheet as rows of text; row n of the result is row n + 1 of the sheet. Throws a message for the user. */
export async function readSheet(file: File | undefined): Promise<string[][]> {
  if (!file) throw new Error('No file provided.');
  if (file.size === 0) throw new Error('Uploaded file is empty.');
  if (file.size > MAX_BYTES) throw new Error('Max 5 MB allowed.');
  const name = file.name.toLowerCase();
  if (name.endsWith('.csv')) return parseCsv(await file.text());
  if (!name.endsWith('.xlsx')) throw new Error('Unsupported file type. Upload a .xlsx or .csv file.');
  const Excel = await loadExcel();
  const book = new Excel.Workbook();
  try {
    await book.xlsx.load(await file.arrayBuffer());
  } catch {
    throw new Error('The file could not be read. Save it as .xlsx or .csv and upload it again.');
  }
  const sheet = book.worksheets[0];
  const rows: string[][] = [];
  sheet?.eachRow({ includeEmpty: false }, (row, n) => {
    const values: string[] = [];
    row.eachCell({ includeEmpty: true }, (cell, c) => { values[c - 1] = cellText(cell.value).trim(); });
    while (rows.length < n - 1) rows.push([]);
    rows.push(Array.from(values, (v) => v ?? ''));
  });
  return rows;
}

/** Downloads rows as a file. Numbers become number cells; text stays text (codes keep their zeros). */
export async function writeSheet(baseName: string, rows: Cell[][], format: SheetFormat) {
  if (format === 'csv') return downloadText(`${baseName}.csv`, toCsv(rows.map((r) => r.map((c) => (c === null ? '' : String(c))))));
  const Excel = await loadExcel();
  const book = new Excel.Workbook();
  const sheet = book.addWorksheet('Sheet1');
  rows.forEach((r) => sheet.addRow(r));
  sheet.columns.forEach((c, n) => { c.width = Math.min(40, Math.max(10, ...rows.map((r) => String(r[n] ?? '').length + 2))); });
  const blob = new Blob([await book.xlsx.writeBuffer()], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${baseName}.xlsx`;
  a.click();
  URL.revokeObjectURL(url);
}
