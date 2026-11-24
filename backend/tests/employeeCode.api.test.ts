/**
 * Employee code API against a real PostgreSQL. Set TEST_DATABASE_URL to a migrated database whose name ends in
 * `_test` (its employees and designations are wiped); skipped when unset.
 */
import type { Express } from 'express';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { AuthUser } from '../src/models/auth';

const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)('employee code API', () => {
  let app: Express;
  let pool: typeof import('../src/config/db').pool;
  let token: string;
  let base: Record<string, unknown>;

  const user: AuthUser = {
    id: '00000000-0000-0000-0000-000000000001', username: 'tester', fullName: 'Tester', branchId: 1, branchType: 'HO',
    allBranches: true, employeeId: null, isAdmin: false, mustChangePassword: false, roles: ['HR'], modules: {},
  };
  const send = (method: 'post' | 'put', path: string, body: object) =>
    request(app)[method](`/api/hr${path}`).set('Authorization', `Bearer ${token}`).send(body);
  const create = (over: object = {}) => send('post', '/employees', { ...base, ...over });
  const update = (id: number, over: object) => send('put', `/employees/${id}`, { ...base, ...over });
  const count = async () => Number((await pool.query('select count(*) as n from hr.employees')).rows[0].n);
  const wipe = () => pool.query('delete from hr.employee_service_histories; delete from hr.employees; delete from hr.employee_designations');

  beforeAll(async () => {
    if (!/_test$/.test(new URL(url!).pathname)) throw new Error('TEST_DATABASE_URL must name a database ending in _test');
    Object.assign(process.env, {
      NODE_ENV: 'test', DATABASE_URL: url, JWT_SECRET: 'test-secret-test-secret-test-secret-1234', MODULES_ENABLED: 'hr,payroll',
    });
    const [{ buildApp }, dbMod, tokens] = await Promise.all([
      import('../src/app'), import('../src/config/db'), import('../src/services/auth/tokenService'),
    ]);
    app = buildApp();
    pool = dbMod.pool;
    token = tokens.signAccessToken(user).token;
    await pool.query(`insert into core.place_categories (code, name, created_by) values ('T', 'Test place', 'test') on conflict (code) do nothing`);
    await pool.query(
      `insert into core.branches (code, name, type, place_id, created_by) select 'TST', 'Test branch', 'HO', id, 'test' from core.place_categories where code = 'T' on conflict (code) do nothing`,
    );
  });
  afterAll(async () => { if (pool) { await wipe(); await pool.end(); } });
  beforeEach(async () => {
    await wipe();
    const d = await send('post', '/designations', { designationName: 'Clerk' });
    const b = await pool.query(`select id from core.branches where code = 'TST'`);
    base = { employeeName: 'R. Kumar', designationId: d.body.id, branchId: b.rows[0].id, dateOfJoining: '2020-06-01', incrementMonth: 7 };
  });

  it('generates a code when blank or missing', async () => {
    expect((await create({ employeeCode: '' })).body.employee_code).toBe('EMP001');
    expect((await create()).body.employee_code).toBe('EMP002');
  });

  it('keeps a typed code as is, without moving the generated sequence', async () => {
    expect((await create({ employeeCode: ' 0007 ' })).body.employee_code).toBe('0007');
    expect((await create()).body.employee_code).toBe('EMP001');
  });

  it('rejects a duplicate or malformed code and saves nothing', async () => {
    await create({ employeeCode: '0001' });
    const dup = await create({ employeeCode: '0001' });
    expect(dup.status).toBe(400);
    expect(dup.body.error.details.employeeCode[0]).toBe('Employee code already exists');
    for (const c of ['EMP009', '00-1', '1'.repeat(21)]) {
      const r = await create({ employeeCode: c });
      expect(r.status).toBe(400);
      expect(r.body.error.details.employeeCode).toBeDefined();
    }
    expect(await count()).toBe(1);
  });

  it('saves an edit that resends the generated code, or leaves it blank or out', async () => {
    const { id } = (await create()).body;
    for (const over of [{ employeeCode: 'EMP001' }, { employeeCode: '' }, {}]) {
      const r = await update(id, { ...over, mobile: '9876543210' });
      expect(r.status).toBe(200);
      expect(r.body).toMatchObject({ employee_code: 'EMP001', mobile: '9876543210' });
    }
  });

  it('changes the code on edit, only to a free digits-only code', async () => {
    const { id } = (await create()).body;
    await create({ employeeCode: '0002' });
    expect((await update(id, { employeeCode: '0002' })).body.error.details.employeeCode[0]).toBe('Employee code already exists');
    expect((await update(id, { employeeCode: 'ABC' })).status).toBe(400);
    expect((await update(id, { employeeCode: '0003' })).body.employee_code).toBe('0003');
    expect((await update(id, { employeeCode: '0003' })).status).toBe(200);
  });
});
