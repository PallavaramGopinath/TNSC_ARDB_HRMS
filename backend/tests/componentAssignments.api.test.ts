/**
 * Component assignments against a real PostgreSQL (docs §3.1). Set TEST_DATABASE_URL to a migrated database
 * whose name ends in `_test` (its employees, designations and payroll assignments are wiped); skipped when unset.
 */
import type { Express } from 'express';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { AuthUser, Role } from '../src/models/auth';

const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)('component assignments API', () => {
  let app: Express;
  let pool: typeof import('../src/config/db').pool;
  let payroll: string;
  let hr: string;
  let admin: string;
  let branchId: number;
  let emp: number;
  let emp2: number;
  const comp: Record<string, number> = {};

  const user = (roles: Role[], isAdmin = false): AuthUser => ({
    id: '00000000-0000-0000-0000-000000000004', username: 'tester', fullName: 'Tester', branchId: 1, branchType: 'HO',
    allBranches: true, employeeId: null, isAdmin, mustChangePassword: false, roles, modules: {},
  });
  const PATH = '/component-assignments';
  const call = (method: 'get' | 'post' | 'put' | 'delete', path: string, body?: object, token = payroll) => {
    const r = request(app)[method](`/api/payroll${path}`).set('Authorization', `Bearer ${token}`);
    return body ? r.send(body) : r;
  };
  const one = async (text: string, values: unknown[] = []) => Number((await pool.query(text, values)).rows[0].id);
  const wipe = () => pool.query(`
    delete from payroll.payroll_component_assignments; delete from payroll.payroll_hra_amounts; delete from payroll.payroll_hra_cca_rates;
    delete from payroll.payroll_periods;
    delete from hr.employee_transfers; delete from hr.employee_promotions;
    delete from hr.employee_service_histories; delete from hr.employees; delete from hr.employee_designations`);

  const body = (amount: number, effectiveFrom = '2026-04-01', effectiveTo?: string) => ({ assignedType: 'FIXED', assignedAmount: amount, effectiveFrom, effectiveTo });
  const add = (code: string, amount: number, from = '2026-04-01', to?: string, token = payroll, employeeId = emp) =>
    call('post', PATH, { employeeId, componentId: comp[code], ...body(amount, from, to) }, token);
  const details = (r: { body: { error: { details: Record<string, string[]> } } }) => r.body.error.details;
  const addPeriod = async (month: number, status = 'OPEN') => {
    await pool.query(`insert into core.financial_years (year_code, short_code, start_date, end_date, created_by) values ('2026-2027', '26-27', '2026-04-01', '2027-03-31', 'test') on conflict do nothing`);
    const to = new Date(Date.UTC(2026, month, 0)).toISOString().slice(0, 10);
    return one(`insert into payroll.payroll_periods (month, calendar_year, from_date, to_date, payroll_type, payroll_status, branch_id, financial_year_id, created_by)
                select $1, 2026, $2, $3, 'SALARY', $4, $5, id, 'test' from core.financial_years where year_code = '2026-2027' returning id`,
      [month, `2026-${String(month).padStart(2, '0')}-01`, to, status, branchId]);
  };
  const addEmployee = (code: string, name: string, designationId: number, seniority: number) =>
    one(`insert into hr.employees (employee_code, employee_name, gender, designation_id, branch_id, increment_month, basic_salary, date_of_joining, seniority_order, created_by)
         values ($1, $2, 'M', $3, $4, 7, 20000, '2020-06-01', $5, 'test') returning id`, [code, name, designationId, branchId, seniority]);

  beforeAll(async () => {
    if (!/_test$/.test(new URL(url!).pathname)) throw new Error('TEST_DATABASE_URL must name a database ending in _test');
    Object.assign(process.env, {
      NODE_ENV: 'test', DATABASE_URL: url, JWT_SECRET: 'test-secret-test-secret-test-secret-1234', MODULES_ENABLED: 'hr,payroll',
    });
    const [{ buildApp }, dbMod, tokens] = await Promise.all([import('../src/app'), import('../src/config/db'), import('../src/services/auth/tokenService')]);
    app = buildApp();
    pool = dbMod.pool;
    payroll = tokens.signAccessToken(user(['Payroll'])).token;
    hr = tokens.signAccessToken(user(['HR'])).token;
    admin = tokens.signAccessToken(user([], true)).token;
    await pool.query(`insert into core.branches (code, name, type, created_by) values ('CA-1', 'CA branch', 'BRANCH', 'test') on conflict (code) do nothing`);
    branchId = await one(`select id from core.branches where code = 'CA-1'`);
    for (const [code, type] of [['BASIC', 1], ['PP', 1], ['GP', 1], ['SP', 1], ['ADL PF', 2], ['CA-WASH', 1], ['CA-SOC', 2], ['CA-OFF', 1]] as const) {
      await pool.query(`insert into payroll.payroll_components (component_name, component_code, component_type, is_active, created_by) values ($1::text, $1::text, $2, $3, 'test') on conflict do nothing`, [code, type, code !== 'CA-OFF']);
      comp[code] = await one('select id from payroll.payroll_components where upper(component_code) = $1', [code]);
    }
  });
  afterAll(async () => {
    if (!pool) return;
    await wipe();
    await pool.query(`delete from payroll.payroll_components where component_code like 'CA-%'; delete from core.branches where code = 'CA-1'`);
    await pool.end();
  });
  beforeEach(async () => {
    await wipe();
    const d = await one(`insert into hr.employee_designations (designation_name, seniority_order, created_by) values ('Assistant', 1, 'test') returning id`);
    emp = await addEmployee('E2', 'Banu', d, 2);
    emp2 = await addEmployee('E1', 'Arun', d, 1);
  });

  describe('add and list', () => {
    it('creates a fixed amount and reads it back', async () => {
      const r = await add('PP', 500.5);
      expect(r.status).toBe(201);
      expect(r.body).toMatchObject({
        employee_id: emp, employee_code: 'E2', employee_name: 'Banu', component_code: 'PP', assigned_type: 'FIXED', assigned_amount: '500.50', percentage: '0.00',
        effective_from: '2026-04-01', effective_to: null, status: 'CURRENT', usedInFinalisedPayroll: false, created_by: 'tester', warnings: [],
      });
      expect((await call('get', `${PATH}/${r.body.id}`)).body.assigned_amount).toBe('500.50');
      expect((await call('get', `${PATH}/999999`)).status).toBe(404);
    });

    it('creates a percentage with limits', async () => {
      const r = await call('post', PATH, { employeeId: emp, componentId: comp['ADL PF'], assignedType: 'PERCENTAGE', percentage: 10, minimumAmount: 100, maximumAmount: 5000, effectiveFrom: '2026-04-01' });
      expect(r.body).toMatchObject({ assigned_type: 'PERCENTAGE', assigned_amount: '0.00', percentage: '10.00', minimum_amount: '100.00', maximum_amount: '5000.00' });
    });

    it('refuses a percentage where payroll would ignore it', async () => {
      for (const c of ['BASIC', 'PP', 'GP', 'SP', 'CA-SOC'])
        expect(details(await call('post', PATH, { employeeId: emp, componentId: comp[c], assignedType: 'PERCENTAGE', percentage: 10, effectiveFrom: '2026-04-01' })).assignedType).toEqual([`${(await pool.query('select component_name from payroll.payroll_components where id = $1', [comp[c]])).rows[0].component_name} must be a fixed amount.`]);
      expect((await call('post', PATH, { employeeId: emp, componentId: comp['CA-WASH'], assignedType: 'PERCENTAGE', percentage: 10, effectiveFrom: '2026-04-01' })).status).toBe(201);
    });

    it('refuses an unknown employee, an inactive component, and a start after leaving', async () => {
      expect(details(await add('PP', 1, '2026-04-01', undefined, payroll, 999999))).toHaveProperty('employeeId');
      expect(details(await add('CA-OFF', 1))).toHaveProperty('componentId');
      await pool.query(`update hr.employees set date_of_leaving = '2026-06-30' where id = $1`, [emp]);
      expect(details(await add('PP', 1, '2026-07-01')).effectiveFrom).toEqual(['The employee left on 2026-06-30.']);
      expect((await add('PP', 1, '2026-06-01')).status).toBe(201);
    });

    it('filters by status, employee, component and search, in payroll print order, with paging', async () => {
      await add('PP', 500, '2026-04-01', '2026-06-30');
      await add('PP', 600, '2026-07-01');
      await add('GP', 2000, '2027-01-01');
      await add('PP', 700, '2026-04-01', undefined, payroll, emp2);
      const list = async (q: string) => (await call('get', `${PATH}?asOn=2026-11-30&${q}`)).body;
      const amounts = async (q: string) => (await list(q)).items.map((x: { assigned_amount: string }) => Number(x.assigned_amount));
      expect(await amounts('status=CURRENT')).toEqual([700, 600]); // Arun (seniority 1) first
      expect(await amounts('status=EXPIRED')).toEqual([500]);
      expect(await amounts('status=FUTURE')).toEqual([2000]);
      expect((await amounts(`status=ALL&employeeId=${emp}`)).sort()).toEqual([2000, 500, 600]);
      expect(await amounts(`componentId=${comp.GP}`)).toEqual([2000]);
      expect(await amounts('search=aru')).toEqual([700]);
      expect(await amounts('search=e2&status=CURRENT')).toEqual([600]);
      expect(await amounts('search=%25')).toEqual([]);
      expect(await list('status=ALL&size=3&page=2')).toMatchObject({ total: 4, page: 2, size: 3, items: [expect.anything()] });
    });

    it('is read-only for HR; Admin may write', async () => {
      expect((await call('get', PATH, undefined, hr)).status).toBe(200);
      expect((await add('PP', 1, '2026-04-01', undefined, hr)).status).toBe(403);
      const a = await add('PP', 1, '2026-04-01', undefined, admin);
      expect(a.status).toBe(201);
      expect((await call('put', `${PATH}/${a.body.id}`, body(2), hr)).status).toBe(403);
      expect((await call('post', `${PATH}/${a.body.id}/revise`, body(2, '2026-05-01'), hr)).status).toBe(403);
      expect((await call('delete', `${PATH}/${a.body.id}`, undefined, hr)).status).toBe(403);
    });
  });

  describe('overlaps', () => {
    it('rejects an overlap for the same employee and component, whatever the type', async () => {
      await add('CA-WASH', 500, '2026-04-01', '2026-09-30');
      const r = await add('CA-WASH', 600, '2026-09-30');
      expect(r.status).toBe(400);
      expect(details(r).effectiveFrom?.[0]).toBe('Overlaps with the CA-WASH assignment from 2026-04-01 to 2026-09-30 for Banu.');
      expect((await call('post', PATH, { employeeId: emp, componentId: comp['CA-WASH'], assignedType: 'PERCENTAGE', percentage: 5, effectiveFrom: '2026-01-01' })).status).toBe(400);
      expect((await add('CA-WASH', 600, '2026-10-01')).status).toBe(201); // next day
      expect((await add('PP', 600, '2026-04-01')).status).toBe(201); // other component
      expect((await add('CA-WASH', 600, '2026-04-01', undefined, payroll, emp2)).status).toBe(201); // other employee
    });

    it('lets only one of two simultaneous entries through', async () => {
      const r = await Promise.all([add('PP', 1), add('PP', 2), add('PP', 3)]);
      expect(r.map((x) => x.status).sort()).toEqual([201, 400, 400]);
    });

    it('treats a row with no start as always in force, and can edit and revise it', async () => {
      const id = await one(`insert into payroll.payroll_component_assignments (employee_id, component_id, assigned_type, assigned_amount, created_by) values ($1, $2, 'FIXED', 100, 'import') returning id`, [emp, comp.PP]);
      expect(details(await add('PP', 1, '2010-01-01')).effectiveFrom?.[0]).toContain('from the beginning to open');
      expect((await call('get', `${PATH}/${id}`)).body).toMatchObject({ effective_from: null, status: 'CURRENT' });
      expect((await call('put', `${PATH}/${id}`, { ...body(150), effectiveFrom: '' })).body).toMatchObject({ assigned_amount: '150.00', effective_from: null });
      expect((await call('post', `${PATH}/${id}/revise`, body(200, '2026-07-01'))).status).toBe(201);
      expect((await call('get', `${PATH}/${id}`)).body).toMatchObject({ effective_from: null, effective_to: '2026-06-30' });
    });
  });

  describe('edit, revise, deactivate', () => {
    it('edits, then deactivates so that the dates are free again', async () => {
      const a = (await add('PP', 500)).body;
      expect((await call('put', `${PATH}/${a.id}`, body(550, '2026-05-01', '2027-03-31'))).body).toMatchObject({ assigned_amount: '550.00', effective_from: '2026-05-01', effective_to: '2027-03-31' });
      expect(details(await call('put', `${PATH}/${a.id}`, { ...body(550), effectiveFrom: '' }))).toHaveProperty('effectiveFrom');
      expect((await call('delete', `${PATH}/${a.id}`)).status).toBe(204);
      expect((await call('get', `${PATH}/${a.id}`)).body.status).toBe('INACTIVE');
      expect((await call('put', `${PATH}/${a.id}`, body(1))).status).toBe(409);
      expect((await call('delete', `${PATH}/${a.id}`)).status).toBe(409);
      expect((await add('PP', 500)).status).toBe(201);
    });

    it('rejects an edit that overlaps another row', async () => {
      await add('PP', 500, '2026-04-01', '2026-06-30');
      const b = (await add('PP', 600, '2026-07-01')).body;
      expect(details(await call('put', `${PATH}/${b.id}`, body(600, '2026-06-30')))).toHaveProperty('effectiveFrom');
    });

    it('revises: closes the old row the day before and keeps it; a bounded row passes its end on', async () => {
      const a = (await add('PP', 500, '2026-04-01', '2027-03-31')).body;
      const r = await call('post', `${PATH}/${a.id}/revise`, body(700, '2026-10-01'));
      expect(r.status).toBe(201);
      expect(r.body).toMatchObject({ assigned_amount: '700.00', effective_from: '2026-10-01', effective_to: '2027-03-31', employee_id: emp });
      expect((await call('get', `${PATH}/${a.id}`)).body).toMatchObject({ assigned_amount: '500.00', effective_to: '2026-09-30', is_active: true });
      expect(details(await call('post', `${PATH}/${r.body.id}/revise`, body(1, '2026-10-01')))).toHaveProperty('effectiveFrom');
    });

    it('records changes in the audit log', async () => {
      const a = (await add('PP', 500)).body;
      await call('put', `${PATH}/${a.id}`, body(550));
      const { rows } = await pool.query(
        `select operation, user_name, changes from audit.row_changes where table_name = 'payroll_component_assignments' and row_pk = $1 order by id`, [String(a.id)]);
      expect(rows.map((x) => [x.operation, x.user_name])).toEqual([['INSERT', 'tester'], ['UPDATE', 'tester']]);
      expect(Number(rows[1].changes.assigned_amount.new)).toBe(550);
    });
  });

  describe('finalised payroll', () => {
    it('fixes the terms once used; only the end may move, after the finalised period', async () => {
      const a = (await add('PP', 500)).body;
      await addPeriod(10, 'LOCKED');
      expect((await call('get', `${PATH}/${a.id}`)).body.usedInFinalisedPayroll).toBe(true);
      expect((await call('put', `${PATH}/${a.id}`, body(501))).status).toBe(409);
      expect((await call('put', `${PATH}/${a.id}`, body(501), admin)).status).toBe(409);
      expect((await call('delete', `${PATH}/${a.id}`)).status).toBe(409);
      expect(details(await call('put', `${PATH}/${a.id}`, body(500, '2026-04-01', '2026-10-30'))).effectiveTo).toEqual(['This would change a finalised period (Oct 2026).']);
      expect((await call('put', `${PATH}/${a.id}`, body(500, '2026-04-01', '2026-10-31'))).body.effective_to).toBe('2026-10-31');
      expect((await call('put', `${PATH}/${a.id}`, body(500, '2026-04-01', '2026-12-31'))).body.effective_to).toBe('2026-12-31');
      expect((await add('PP', 700, '2027-01-01')).status).toBe(201);
      expect(details(await call('put', `${PATH}/${a.id}`, body(500)))).toHaveProperty('effectiveFrom'); // reopening would overlap
    });

    it('refuses dates that cover a finalised period, except for Admin, who is warned', async () => {
      await addPeriod(10, 'APPROVED');
      for (const from of ['2026-04-01', '2026-10-15']) expect(details(await add('PP', 500, from)).effectiveFrom).toEqual(['These dates cover a finalised period (Oct 2026).']);
      expect((await add('PP', 500, '2026-04-01', '2026-09-30')).status).toBe(201); // October untouched
      const a = await add('GP', 500, '2026-04-01', undefined, admin);
      expect(a.status).toBe(201);
      expect(a.body.warnings[0]).toContain('Oct 2026');
      expect((await call('post', `${PATH}/${a.body.id}/revise`, body(600, '2026-10-01'))).status).toBe(400);
      expect((await call('post', `${PATH}/${a.body.id}/revise`, body(600, '2026-11-01'))).status).toBe(201);
    });
  });

  it('feeds the allowance preview: PP and GP, shared by days when they change within the month (spec 08 Q4)', async () => {
    const nov = await addPeriod(11);
    const pay = async () => {
      const e = (await call('get', `/periods/${nov}/allowances`)).body.employees.find((x: { employeeId: number }) => x.employeeId === emp);
      return [e.basic, e.pp, e.gp, e.basicPay].map(Number);
    };
    expect(await pay()).toEqual([20000, 0, 0, 20000]);
    const pp = (await add('PP', 500)).body;
    await add('GP', 2000, '2026-11-16');
    expect(await pay()).toEqual([20000, 500, 1000, 21500]); // GP for 15 of 30 days
    await call('post', `${PATH}/${pp.id}/revise`, body(750, '2026-11-01'));
    expect(await pay()).toEqual([20000, 750, 1000, 21750]);
    const cur = (await call('get', `${PATH}?employeeId=${emp}&componentId=${comp.PP}&status=CURRENT&asOn=2026-11-30`)).body.items[0];
    await call('delete', `${PATH}/${cur.id}`);
    expect(await pay()).toEqual([20000, 0, 1000, 21000]);
  });
});
