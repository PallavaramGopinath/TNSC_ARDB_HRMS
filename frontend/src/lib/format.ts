const inr = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2, minimumFractionDigits: 2 });

/** ₹1,23,456.00 (Indian grouping). Accepts the API's numeric strings. */
export const formatINR = (v: string | number | null | undefined) => (v === null || v === undefined || v === '' ? '—' : inr.format(Number(v)));

/** 'YYYY-MM-DD' → '06-11-2026' (TNCU dd-MM-yyyy). */
export const formatDate = (d: string | null | undefined) => {
  if (!d) return '—';
  const [y, m, day] = d.slice(0, 10).split('-');
  return `${day}-${m}-${y}`;
};

export const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** 'COMPASSIONATE_GROUND' → 'Compassionate ground' */
export const humanize = (v: string | null | undefined) => (v ? v.charAt(0) + v.slice(1).toLowerCase().replace(/_/g, ' ') : '—');

/** Mask all but the last 4 characters (Aadhaar, account numbers). */
export const maskTail = (v: string | null | undefined) => (v ? `${'•'.repeat(Math.max(0, v.length - 4))}${v.slice(-4)}` : '—');
