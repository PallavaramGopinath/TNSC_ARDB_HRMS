/**
 * Applies database/schema.sql on an empty database (baseline 0001), then every
 * database/migrations/NNNN_*.sql not yet recorded in core.schema_migrations — each in one transaction.
 */
import 'dotenv/config';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import pg from 'pg';

const dbDir = join(__dirname, '..', '..', 'database');

async function main() {
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    const { rows } = await client.query(`select to_regclass('core.schema_migrations') as t`);
    if (!rows[0].t) {
      console.log('→ applying baseline schema.sql');
      await client.query('BEGIN');
      await client.query(readFileSync(join(dbDir, 'schema.sql'), 'utf8'));
      await client.query('COMMIT');
    }
    const applied = new Set((await client.query('select version from core.schema_migrations')).rows.map((r) => r.version));
    const files = readdirSync(join(dbDir, 'migrations')).filter((f) => /^\d{4}_.+\.sql$/.test(f)).sort();
    for (const f of files) {
      const version = f.replace(/\.sql$/, '');
      if (applied.has(version)) continue;
      console.log(`→ applying ${f}`);
      await client.query('BEGIN');
      await client.query(readFileSync(join(dbDir, 'migrations', f), 'utf8'));
      await client.query('insert into core.schema_migrations(version) values ($1)', [version]);
      await client.query('COMMIT');
    }
    console.log('✓ database is up to date');
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
