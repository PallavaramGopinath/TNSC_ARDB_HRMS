import { Kysely, PostgresDialect } from 'kysely';
import pg from 'pg';
import { env } from './env';
import type { Database } from '../models/db.types';

// Type parsing (keep money exact, keep business dates timezone-free):
//   int8    → number (ids, counts fit in 2^53)
//   numeric → string (wrap in Decimal from lib/money for arithmetic)
//   date    → 'YYYY-MM-DD' string (never shifted by the server timezone)
pg.types.setTypeParser(20, (v) => Number(v));
pg.types.setTypeParser(1082, (v) => v);

export const pool = new pg.Pool({ connectionString: env.DATABASE_URL, max: 10 });

export const db = new Kysely<Database>({ dialect: new PostgresDialect({ pool }) });

export async function checkDb(): Promise<boolean> {
  try {
    await pool.query('select 1');
    return true;
  } catch {
    return false;
  }
}
