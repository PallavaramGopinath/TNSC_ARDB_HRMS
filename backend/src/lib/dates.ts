/** Business-date helpers. ARDB has no day cycle (D4): the business date is today in Asia/Kolkata. */
const TZ = 'Asia/Kolkata';

/** Today as 'YYYY-MM-DD' in IST. */
export function businessDate(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

/** Parse 'YYYY-MM-DD' to a day number (days since epoch, UTC) — mirrors C# DateOnly.DayNumber arithmetic. */
export function dayNumber(d: string): number {
  const [y, m, day] = d.split('-').map(Number) as [number, number, number];
  return Math.floor(Date.UTC(y, m - 1, day) / 86_400_000);
}

export function fromDayNumber(n: number): string {
  return new Date(n * 86_400_000).toISOString().slice(0, 10);
}

export function addDays(d: string, days: number): string {
  return fromDayNumber(dayNumber(d) + days);
}

/** Inclusive day count between two dates. */
export function daysInclusive(from: string, to: string): number {
  return dayNumber(to) - dayNumber(from) + 1;
}

export function monthBounds(year: number, month: number): { from: string; to: string } {
  const from = `${year}-${String(month).padStart(2, '0')}-01`;
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return { from, to: `${year}-${String(month).padStart(2, '0')}-${String(last).padStart(2, '0')}` };
}
