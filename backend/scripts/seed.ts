/** Runs database/seed.sql (idempotent upserts: settings, leave types, components, rates, menu, admin). */
import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import pg from 'pg';

async function main() {
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    await client.query('BEGIN');
    await client.query(readFileSync(join(__dirname, '..', '..', 'database', 'seed.sql'), 'utf8'));
    await client.query('COMMIT');
    console.log('✓ seed applied');
  } catch (e) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw e;
  } finally {
    await client.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
