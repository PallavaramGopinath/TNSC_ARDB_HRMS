import { db } from '../config/db';
import { businessDate } from './dates';

/**
 * Effective-dated rule values from core.app_settings (ARDB D9).
 * getSetting('hr.increment.percent', 3) → value in force on `onDate` (default: business date),
 * or `fallback` if no row exists. Cached for 60 s.
 */
const cache = new Map<string, { at: number; value: unknown }>();
const TTL_MS = 60_000;

export async function getSetting<T>(key: string, fallback: T, onDate: string = businessDate()): Promise<T> {
  const ck = `${key}@${onDate}`;
  const hit = cache.get(ck);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value as T;

  const row = await db
    .selectFrom('core.app_settings')
    .select('value')
    .where('key', '=', key)
    .where('effective_from', '<=', onDate)
    .where((eb) => eb.or([eb('effective_to', 'is', null), eb('effective_to', '>=', onDate)]))
    .orderBy('effective_from', 'desc')
    .executeTakeFirst();

  const value = (row?.value ?? fallback) as T;
  cache.set(ck, { at: Date.now(), value });
  return value;
}

export const clearSettingsCache = () => cache.clear();
