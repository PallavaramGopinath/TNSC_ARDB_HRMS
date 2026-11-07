import { randomUUID } from 'node:crypto';
import svgCaptcha from 'svg-captcha';

/**
 * Login captcha (TNCU /api/auth/captcha). In-memory, single-use, 5-minute TTL.
 * Swap for a shared store (Redis / DB) if the API is scaled out to several instances.
 */
const TTL_MS = 5 * 60_000;
const store = new Map<string, { text: string; exp: number }>();

export function createCaptcha(): { captchaId: string; svg: string } {
  const c = svgCaptcha.create({ size: 5, noise: 2, ignoreChars: '0oO1ilI', color: true, background: '#fff7f5' });
  const captchaId = randomUUID();
  store.set(captchaId, { text: c.text, exp: Date.now() + TTL_MS });
  sweep();
  return { captchaId, svg: c.data };
}

export function verifyCaptcha(captchaId: string | undefined, answer: string | undefined): boolean {
  if (!captchaId || !answer) return false;
  const entry = store.get(captchaId);
  store.delete(captchaId); // single use
  return !!entry && entry.exp > Date.now() && entry.text.toLowerCase() === answer.trim().toLowerCase();
}

function sweep() {
  const now = Date.now();
  for (const [k, v] of store) if (v.exp <= now) store.delete(k);
}
