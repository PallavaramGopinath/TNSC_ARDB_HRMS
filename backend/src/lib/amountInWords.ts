/**
 * Rupees in words, Indian system (crore, lakh, thousand), as printed on pay bills:
 *   262496    → "Rupees Two Lakh Sixty Two Thousand Four Hundred Ninety Six Only"
 *   1050.50   → "Rupees One Thousand Fifty and Paise Fifty Only"
 */
import { D, type MoneyInput } from './money';

const ONES = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen',
  'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

const belowHundred = (n: number) => (n < 20 ? ONES[n]! : `${TENS[Math.floor(n / 10)]}${n % 10 ? ` ${ONES[n % 10]}` : ''}`);
const belowThousand = (n: number) => {
  const h = Math.floor(n / 100);
  const rest = n % 100;
  return [h ? `${ONES[h]} Hundred` : '', rest ? belowHundred(rest) : ''].filter(Boolean).join(' ');
};

/** Whole number in words (0 → "Zero"). Crores above 99 repeat the lakh/thousand scale: 125,00,00,000 → "One Hundred Twenty Five Crore". */
export function numberInWords(n: number): string {
  if (n === 0) return 'Zero';
  const parts: string[] = [];
  const crore = Math.floor(n / 10_000_000);
  if (crore) parts.push(`${numberInWords(crore)} Crore`);
  let r = n % 10_000_000;
  const lakh = Math.floor(r / 100_000);
  if (lakh) parts.push(`${belowHundred(lakh)} Lakh`);
  r %= 100_000;
  const thousand = Math.floor(r / 1000);
  if (thousand) parts.push(`${belowHundred(thousand)} Thousand`);
  r %= 1000;
  if (r) parts.push(belowThousand(r));
  return parts.join(' ');
}

export function rupeesInWords(amount: MoneyInput): string {
  const x = D(amount).abs().toDecimalPlaces(2);
  const rupees = x.floor().toNumber();
  const paise = x.minus(x.floor()).times(100).round().toNumber();
  const sign = D(amount).isNegative() ? 'Minus ' : '';
  return `${sign}Rupees ${numberInWords(rupees)}${paise ? ` and Paise ${belowHundred(paise)}` : ''} Only`;
}
