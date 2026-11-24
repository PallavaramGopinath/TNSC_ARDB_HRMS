/**
 * Payroll print order (spec 04 §4.3) against a real PostgreSQL. Set TEST_DATABASE_URL to a migrated and seeded
 * database whose name ends in `_test`; skipped when unset. All rows live in a transaction that is rolled back.
 */
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { payrollPrintOrder } from '../src/services/payroll/printOrder';

const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)('payroll print order', () => {
  let db: typeof import('../src/config/db').db;

  beforeAll(async () => {
    if (!/_test$/.test(new URL(url!).pathname)) throw new Error('TEST_DATABASE_URL must name a database ending in _test');
    Object.assign(process.env, {
      NODE_ENV: 'test', DATABASE_URL: url, JWT_SECRET: 'test-secret-test-secret-test-secret-1234', MODULES_ENABLED: 'hr,payroll',
    });
    ({ db } = await import('../src/config/db'));
  });
  afterAll(async () => { await db?.destroy(); });

  it('designation seniority, then employee seniority, then code; blanks last', async () => {
    const rollback = new Error('rollback');
    let codes: string[] = [];
    await db
      .transaction()
      .execute(async (trx) => {
        const designation = async (name: string, seniority: number | null) =>
          (await trx
            .insertInto('hr.employee_designations')
            .values({ designation_name: name, seniority_order: seniority, created_by: 'test' } as never)
            .returning('id')
            .executeTakeFirstOrThrow()).id;
        const employee = (code: string, designationId: number, seniority: number | null) =>
          sql`insert into hr.employees (employee_code, employee_name, designation_id, branch_id, increment_month, seniority_order, created_by)
              values (${code}, ${code}, ${designationId}, (select min(id) from core.branches), 1, ${seniority}, 'test')`.execute(trx);

        const unranked = await designation('Unranked', null);
        const clerk = await designation('Clerk', 2);
        const manager = await designation('Manager', 1);
        // Inserted out of order on purpose; codes do not follow the expected order.
        await employee('PO1', unranked, 1);
        await employee('PO2', clerk, null);
        await employee('PO3', clerk, 2);
        await employee('PO5', clerk, 1);
        await employee('PO4', clerk, 2);
        await employee('PO6', manager, 9);
        await employee('PO7', manager, 10);

        const rows = await trx
          .selectFrom('hr.employees as e')
          .innerJoin('hr.employee_designations as d', 'd.id', 'e.designation_id')
          .select('e.employee_code')
          .where('e.employee_code', 'like', 'PO%')
          .orderBy(payrollPrintOrder)
          .execute();
        codes = rows.map((r) => r.employee_code);
        throw rollback;
      })
      .catch((e) => { if (e !== rollback) throw e; });

    expect(codes).toEqual(['PO6', 'PO7', 'PO5', 'PO3', 'PO4', 'PO2', 'PO1']);
  });
});
