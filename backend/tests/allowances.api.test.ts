/**
 * HRA amounts, HRA method and allowance preview against a real PostgreSQL (specs/06). Set TEST_DATABASE_URL to
 * a migrated database whose name ends in `_test` (its employees, designations and payroll rates are wiped);
 * skipped when unset.
 */
import type { Express } from 'express';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { AuthUser, Role } from '../src/models/auth';

const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)('allowances API', () => {
  let app: Express;
  let pool: typeof import('../src/config/db').pool;
  let clearSettingsCache: () => void;
  let payroll: string;
  let hr: string;
  let admin: string;
  let branch: Record<'GCC' | 'OP' | 'NONE', number>;
  let place: Record<'GCC' | 'OP', number>;
  let des: Record<'dgm' | 'assistant' | 'manager', number>;

  const user = (roles: Role[], isAdmin = false): AuthUser => ({
    id: '00000000-0000-0000-0000-000000000003', username: 'tester', fullName: 'Tester', branchId: 1, branchType: 'HO',
    allBranches: true, employeeId: null, isAdmin, mustChangePassword: false, roles, modules: {},
  });
  const call = (method: 'get' | 'post' | 'put' | 'delete', path: string, body?: object, token = payroll) => {
    const r = request(app)[method](`/api/payroll${path}`).set('Authorization', `Bearer ${token}`);
    return body ? r.send(body) : r;
  };
  const one = async (text: string, values: unknown[] = []) => Number((await pool.query(text, values)).rows[0].id);
  const wipe = async () => {
    await pool.query(`
      delete from payroll.payroll_component_assignments; delete from payroll.payroll_hra_amounts; delete from payroll.payroll_hra_cca_rates;
      delete from payroll.payroll_periods; delete from payroll.payroll_da_rates;
      delete from core.app_settings where key in ('payroll.hra_cca.basis', 'payroll.medical_allowance.amount');
      delete from hr.employee_transfers; delete from hr.employee_promotions;
      delete from hr.employee_service_histories; delete from hr.employees; delete from hr.employee_designations`);
    clearSettingsCache();
  };
  const addAmount = (designationId: number, gccAmount: number, otherAmount: number, effectiveFrom = '2026-04-01') =>
    call('post', '/rates/hra-amounts', { designationId, gccAmount, otherAmount, effectiveFrom });
  const addCca = (placeId: number, ccaPercent: number, ccaMinAmount: number, ccaMaxAmount: number) =>
    call('post', '/rates/hra-cca', { placeId, hraPercent: 0, ccaPercent, ccaMinAmount, ccaMaxAmount, effectiveFrom: '2026-04-01' });
  const addEmployee = (code: string, designationId: number, branchId: number, basic: number, joined = '2020-06-01') =>
    one(`insert into hr.employees (employee_code, employee_name, gender, designation_id, branch_id, increment_month, basic_salary, date_of_joining, created_by)
         values ($1::text, $1::text, 'M', $2, $3, 7, $4, $5, 'test') returning id`, [code, designationId, branchId, basic, joined]);
  const addPeriod = async (month: number, type = 'SALARY') => {
    await pool.query(`insert into core.financial_years (year_code, short_code, start_date, end_date, created_by) values ('2026-2027', '26-27', '2026-04-01', '2027-03-31', 'test') on conflict do nothing`);
    const to = new Date(Date.UTC(2026, month, 0)).toISOString().slice(0, 10);
    return one(`insert into payroll.payroll_periods (month, calendar_year, from_date, to_date, payroll_type, branch_id, financial_year_id, created_by)
                select $1, 2026, $2, $3, $4, $5, id, 'test' from core.financial_years where year_code = '2026-2027' returning id`,
      [month, `2026-${String(month).padStart(2, '0')}-01`, to, type, branch.GCC]);
  };
  const useFixedAmounts = async () => {
    await pool.query(`insert into core.app_settings (module, key, value, created_by) values ('payroll', 'payroll.hra_cca.basis', '"FIXED_AMOUNT"', 'test')
                      on conflict (key, effective_from) do update set value = excluded.value`);
    clearSettingsCache();
  };
  /** Everything spec 06 needs, with the §8 illustration rate. */
  const setUp = async () => {
    await useFixedAmounts();
    await pool.query(`insert into core.app_settings (module, key, value, created_by) values ('payroll', 'payroll.medical_allowance.amount', '1000', 'test')`);
    await pool.query(`insert into payroll.payroll_da_rates (effective_from, da_percentage, created_by) values ('2026-04-01', 30.38, 'test')`);
    await addCca(place.GCC, 5, 1000, 1500);
    await addCca(place.OP, 3, 800, 1000);
    await addAmount(des.dgm, 5000, 5000);
    await addAmount(des.assistant, 3000, 2500);
    clearSettingsCache();
  };
  const preview = async (periodId: number) => {
    const r = await call('get', `/periods/${periodId}/allowances`);
    expect(r.status).toBe(200);
    const row = (code: string) => r.body.employees.find((e: { employeeCode: string }) => e.employeeCode === code);
    return { body: r.body, row };
  };
  const amounts = (e: Record<string, string>) => [e.basicPay, e.da, e.hra, e.cca, e.ma, e.total].map(Number);

  beforeAll(async () => {
    if (!/_test$/.test(new URL(url!).pathname)) throw new Error('TEST_DATABASE_URL must name a database ending in _test');
    Object.assign(process.env, {
      NODE_ENV: 'test', DATABASE_URL: url, JWT_SECRET: 'test-secret-test-secret-test-secret-1234', MODULES_ENABLED: 'hr,payroll',
    });
    const [{ buildApp }, dbMod, tokens, settings] = await Promise.all([
      import('../src/app'), import('../src/config/db'), import('../src/services/auth/tokenService'), import('../src/lib/settings'),
    ]);
    app = buildApp();
    pool = dbMod.pool;
    clearSettingsCache = settings.clearSettingsCache;
    payroll = tokens.signAccessToken(user(['Payroll'])).token;
    hr = tokens.signAccessToken(user(['HR'])).token;
    admin = tokens.signAccessToken(user([], true)).token;

    for (const [code, name] of [['GCC', 'Greater Chennai Corporation'], ['OP', 'Other Places']])
      await pool.query(`insert into core.place_categories (code, name, created_by) values ($1, $2, 'test') on conflict (code) do nothing`, [code, name]);
    place = { GCC: 0, OP: 0 };
    for (const c of ['GCC', 'OP'] as const) place[c] = await one('select id from core.place_categories where code = $1', [c]);
    branch = { GCC: 0, OP: 0, NONE: 0 };
    for (const c of ['GCC', 'OP', 'NONE'] as const) {
      await pool.query(`insert into core.branches (code, name, type, place_id, created_by) values ($1, $2, 'BRANCH', $3, 'test') on conflict (code) do nothing`,
        [`AL-${c}`, `${c} branch`, c === 'NONE' ? null : place[c]]);
      branch[c] = await one('select id from core.branches where code = $1', [`AL-${c}`]);
    }
    for (const c of ['BASIC', 'PP', 'GP', 'SP'])
      await pool.query(`insert into payroll.payroll_components (component_name, component_code, component_type, created_by) values ($1::text, $1::text, 1, 'test') on conflict do nothing`, [c]);
  });
  afterAll(async () => {
    if (!pool) return;
    await wipe();
    await pool.query(`delete from core.branches where code like 'AL-%'`);
    await pool.end();
  });
  beforeEach(async () => {
    await wipe();
    des = { dgm: 0, assistant: 0, manager: 0 };
    for (const [k, name, order] of [['dgm', 'Deputy General Manager', 1], ['manager', 'Manager', 2], ['assistant', 'Assistant', 3]] as const)
      des[k] = await one(`insert into hr.employee_designations (designation_name, seniority_order, created_by) values ($1, $2, 'test') returning id`, [name, order]);
  });

  describe('HRA amounts master', () => {
    it('creates, lists and reads back', async () => {
      const r = await addAmount(des.assistant, 3000, 2500, '2022-01-01');
      expect(r.status).toBe(201);
      expect(r.body).toMatchObject({ designation_name: 'Assistant', gcc_amount: '3000.00', other_amount: '2500.00', status: 'CURRENT', created_by: 'tester' });
      const list = await call('get', '/rates/hra-amounts?status=CURRENT&search=assis');
      expect(list.body.items.map((x: { id: number }) => x.id)).toEqual([r.body.id]);
    });

    it('rejects an overlap for the same designation, and an inactive designation', async () => {
      await addAmount(des.assistant, 3000, 2500);
      const r = await addAmount(des.assistant, 3100, 2600, '2026-10-01');
      expect(r.status).toBe(400);
      expect(r.body.error.details.effectiveFrom[0]).toContain('Overlaps');
      await pool.query('update hr.employee_designations set is_active = false where id = $1', [des.dgm]);
      expect((await addAmount(des.dgm, 5000, 5000)).status).toBe(400);
    });

    it('revises: closes the old row the day before and keeps it', async () => {
      const a = (await addAmount(des.assistant, 3000, 2500)).body;
      const r = await call('post', `/rates/hra-amounts/${a.id}/revise`, { gccAmount: 3300, otherAmount: 2700, effectiveFrom: '2027-01-01' });
      expect(r.status).toBe(201);
      expect((await call('get', `/rates/hra-amounts/${a.id}`)).body).toMatchObject({ effective_to: '2026-12-31', is_active: true, gcc_amount: '3000.00' });
      expect((await call('post', `/rates/hra-amounts/${r.body.id}/revise`, { gccAmount: 1, otherAmount: 1, effectiveFrom: '2027-01-01' })).status).toBe(400);
    });

    it('edits, then deactivates so that the dates are free again', async () => {
      const a = (await addAmount(des.assistant, 3000, 2500)).body;
      const r = await call('put', `/rates/hra-amounts/${a.id}`, { gccAmount: 3100, otherAmount: 2500, effectiveFrom: '2026-05-01', remarks: 'fixed' });
      expect(r.body).toMatchObject({ gcc_amount: '3100.00', effective_from: '2026-05-01', remarks: 'fixed', updated_by: 'tester' });
      expect((await call('delete', `/rates/hra-amounts/${a.id}`)).status).toBe(204);
      expect((await addAmount(des.assistant, 3000, 2500)).status).toBe(201);
    });

    it('lets only remarks change once used in a finalised payroll', async () => {
      const a = (await addAmount(des.assistant, 3000, 2500)).body;
      const p = await addPeriod(10);
      await pool.query(`update payroll.payroll_periods set payroll_status = 'LOCKED' where id = $1`, [p]);
      const body = { gccAmount: 3000, otherAmount: 2500, effectiveFrom: '2026-04-01' };
      expect((await call('put', `/rates/hra-amounts/${a.id}`, { ...body, gccAmount: 9 })).status).toBe(409);
      expect((await call('put', `/rates/hra-amounts/${a.id}`, { ...body, remarks: 'G.O.' })).body.remarks).toBe('G.O.');
      expect((await call('delete', `/rates/hra-amounts/${a.id}`)).status).toBe(409);
      expect((await addAmount(des.dgm, 5000, 5000, '2026-10-15')).status).toBe(400);
    });

    it('is read-only for HR', async () => {
      expect((await call('get', '/rates/hra-amounts', undefined, hr)).status).toBe(200);
      expect((await call('post', '/rates/hra-amounts', { designationId: des.dgm, gccAmount: 1, otherAmount: 1, effectiveFrom: '2026-04-01' }, hr)).status).toBe(403);
    });

    it('blocks an overlap in the database too', async () => {
      await addAmount(des.assistant, 3000, 2500);
      await expect(pool.query(`insert into payroll.payroll_hra_amounts (designation_id, gcc_amount, other_amount, effective_from, created_by) values ($1, 1, 1, '2026-06-01', 'x')`, [des.assistant])).rejects.toThrow(/ex_hra_amounts_overlap/);
    });
  });

  describe('HRA method', () => {
    it('switches to fixed amounts, Admin only, and keeps the history', async () => {
      expect((await call('put', '/settings/hra-cca-basis', { method: 'FIXED_AMOUNT' })).status).toBe(403);
      const r = await call('put', '/settings/hra-cca-basis', { method: 'FIXED_AMOUNT' }, admin);
      expect(r.body).toMatchObject({ method: 'FIXED_AMOUNT', rateCounts: { PLACE: 0, DESIGNATION: 0, FIXED_AMOUNT: 0 } });
      expect((await call('put', '/settings/hra-cca-basis', { method: 'FIXED_AMOUNT' }, admin)).status).toBe(400);
      expect((await call('put', '/settings/hra-cca-basis', { method: 'DESIGNATION' }, admin)).body.method).toBe('DESIGNATION');
    });

    it('keeps place rates editable under every method, designation rates only under DESIGNATION', async () => {
      const designationRate = (pct: number) => call('post', '/rates/hra-cca', { designationId: des.manager, hraPercent: pct, ccaPercent: 0, effectiveFrom: '2026-04-01' });
      expect((await designationRate(8)).status).toBe(400); // PLACE by default
      await call('put', '/settings/hra-cca-basis', { method: 'DESIGNATION' }, admin);
      const d = await designationRate(8);
      expect(d.status).toBe(201);
      const c = await addCca(place.GCC, 5, 1000, 1500);
      expect(c.status).toBe(201);
      await call('put', '/settings/hra-cca-basis', { method: 'FIXED_AMOUNT' }, admin);
      expect((await call('delete', `/rates/hra-cca/${d.body.id}`)).status).toBe(409);
      expect((await call('get', '/rates/hra-cca?basis=DESIGNATION')).body).toMatchObject({ readOnly: true, method: 'FIXED_AMOUNT', total: 1 });
      const bulk = await call('post', '/rates/hra-cca/bulk-revise', { basis: 'PLACE', effectiveFrom: '2027-01-01', items: [{ keyId: place.GCC, hraPercent: 0, ccaPercent: 6 }] });
      expect(bulk.body.count).toBe(1);
      expect((await call('post', '/rates/hra-cca/bulk-revise', { basis: 'DESIGNATION', effectiveFrom: '2027-01-01', items: [{ keyId: des.manager, hraPercent: 1, ccaPercent: 0 }] })).status).toBe(409);
    });

    it('reports HRA and CCA gaps separately', async () => {
      await useFixedAmounts();
      await addAmount(des.assistant, 3000, 2500);
      await addAmount(des.dgm, 5000, 5000);
      await addCca(place.GCC, 5, 1000, 1500);
      await addEmployee('A1', des.assistant, branch.GCC, 1);
      await addEmployee('A2', des.assistant, branch.NONE, 1);
      await addEmployee('M1', des.manager, branch.OP, 1);
      await addEmployee('D1', des.dgm, branch.NONE, 1); // equal amounts need no place for HRA
      const r = (await call('get', '/rates/hra-cca/missing?asOn=2026-11-30')).body;
      expect(r.hra).toEqual({ keysWithEmployees: 3, missing: [
        { keyId: null, keyName: 'Branch has no place category', employeeCount: 1 },
        { keyId: des.manager, keyName: 'Manager', employeeCount: 1 },
      ] });
      expect(r.cca.missing).toEqual([
        { keyId: null, keyName: 'Branch has no place category', employeeCount: 2 },
        { keyId: place.OP, keyName: 'Other Places', employeeCount: 1 },
      ]);
    });
  });

  describe('preview', () => {
    it('gives the spec §8 amounts in print order', async () => {
      await setUp();
      await addEmployee('E4', des.assistant, branch.GCC, 22500);
      await addEmployee('E1', des.dgm, branch.GCC, 51160);
      const { body, row } = await preview(await addPeriod(11));
      expect(body).toMatchObject({ method: 'FIXED_AMOUNT', medicalAmount: '1000.00', employeeCount: 2, employeesWithErrors: 0, ready: true });
      expect(body.employees.map((e: { employeeCode: string }) => e.employeeCode)).toEqual(['E1', 'E4']);
      expect(amounts(row('E1'))).toEqual([51160, 15542, 5000, 1500, 1000, 23042]);
      expect(amounts(row('E4'))).toEqual([22500, 6836, 3000, 1125, 1000, 11961]);
      expect(row('E4').applied).toMatchObject({ hraRowIds: [expect.any(Number)], ccaRowIds: [expect.any(Number)], daRateId: expect.any(Number) });
    });

    it('adds PP and GP assignments in force, ignores SP, and prefers the BASIC assignment', async () => {
      await setUp();
      const e = await addEmployee('E1', des.assistant, branch.GCC, 1);
      const assign = (code: string, amount: number, from: string | null, to: string | null = null) =>
        pool.query(`insert into payroll.payroll_component_assignments (employee_id, component_id, assigned_type, assigned_amount, effective_from, effective_to, created_by)
                    select $1, id, 'FIXED', $2, $3, $4, 'test' from payroll.payroll_components where component_code = $5`, [e, amount, from, to, code]);
      await assign('BASIC', 19000, null);
      await assign('BASIC', 20000, '2026-07-01');
      await assign('BASIC', 90000, '2026-12-01');
      await assign('PP', 500, '2026-04-01');
      await assign('GP', 2000, '2026-04-01');
      await assign('GP', 9000, '2025-04-01', '2026-03-31');
      const p = await addPeriod(11);
      const before = (await preview(p)).row('E1');
      expect([before.basic, before.pp, before.gp, before.basicPay]).toEqual(['20000.00', '500.00', '2000.00', '22500.00']);
      await assign('SP', 5000, '2026-04-01');
      const after = (await preview(p)).row('E1');
      expect([after.da, after.cca]).toEqual([before.da, before.cca]);
    });

    it('uses the rates of the period: a revised DA rate leaves earlier months alone', async () => {
      await setUp();
      await addEmployee('E1', des.assistant, branch.GCC, 22500);
      const oct = await addPeriod(10);
      const nov = await addPeriod(11);
      expect((await call('post', '/rates/da', { effectiveFrom: '2026-11-01', daPercentage: 31.5 })).status).toBe(201);
      expect((await preview(oct)).row('E1').da).toBe('6836.00');
      expect((await preview(nov)).row('E1').da).toBe('7088.00'); // 7087.50
    });

    it('splits HRA and CCA on a transfer and a promotion within the month', async () => {
      await setUp();
      await addAmount(des.manager, 4000, 3500);
      const e = await addEmployee('E1', des.manager, branch.OP, 22500); // record holds the latest posting
      await pool.query(`insert into hr.employee_transfers (employee_id, from_branch_id, to_branch_id, joining_date, created_by) values ($1, $2, $3, '2026-11-19', 'test')`, [e, branch.GCC, branch.OP]);
      // Approved: Assistant until 10 November. The pending one must be ignored.
      for (const [date, status] of [['2026-11-11', 'APPROVED'], ['2026-11-25', 'PENDING_APPROVAL']])
        await pool.query(`insert into hr.employee_promotions (employee_id, promotion_date, promotion_type, status, from_designation_id, to_designation_id, created_by) values ($1, $2, 'REGULAR', $3, $4, $5, 'test')`,
          [e, date, status, des.assistant, des.manager]);
      const nov = await addPeriod(11);
      const r = (await preview(nov)).row('E1');
      expect(Number(r.hra)).toBe(1000 + 1067 + 1400); // 3000 × 10/30 + 4000 × 8/30 + 3500 × 12/30
      expect(Number(r.cca)).toBe(675 + 320); // 5% part; 3% part raised to 800 × 12/30
      expect([r.designation, r.branch, r.place]).toEqual(['Manager', 'OP branch', 'Other Places']);
      expect((await preview(await addPeriod(10))).row('E1')).toMatchObject({ hra: '3000.00', designation: 'Assistant', branch: 'GCC branch' }); // October: before both
    });

    it('reports what is missing instead of paying 0, and the Deputy General Manager needs no place for HRA', async () => {
      await useFixedAmounts();
      await addAmount(des.dgm, 5000, 5000);
      await addAmount(des.assistant, 3000, 2500);
      await addEmployee('D1', des.dgm, branch.NONE, 51160);
      await addEmployee('A1', des.assistant, branch.NONE, 22500);
      await addEmployee('M1', des.manager, branch.GCC, 0);
      const { body, row } = await preview(await addPeriod(11));
      expect(body).toMatchObject({ ready: false, employeesWithErrors: 3, daRate: null, medicalAmount: null });
      const codes = (c: string) => row(c).issues.map((i: { code: string }) => i.code).sort();
      expect(codes('D1')).toEqual(['CCA', 'DA_RATE', 'MA']);
      expect(row('D1').hra).toBe('5000.00');
      expect(codes('A1')).toEqual(['CCA', 'DA_RATE', 'HRA', 'MA']);
      expect(codes('M1')).toEqual(['BASIC_PAY', 'CCA', 'DA_RATE', 'HRA', 'MA']);
      expect([row('A1').da, row('A1').hra, row('A1').cca, row('A1').ma, row('A1').total]).toEqual([null, null, null, null, null]);
      expect(row('M1').issues.find((i: { code: string }) => i.code === 'HRA').message).toBe('No HRA amount for Designation Manager as on 2026-11-30');
    });

    it('warns about a part month, leaves out people not in service, and refuses other pay types', async () => {
      await setUp();
      await addEmployee('NEW', des.assistant, branch.GCC, 22500, '2026-11-16');
      await addEmployee('LATER', des.assistant, branch.GCC, 22500, '2026-12-01');
      const { body, row } = await preview(await addPeriod(11));
      expect(body).toMatchObject({ employeeCount: 1, ready: true });
      expect(row('NEW').issues).toEqual([{ code: 'PART_MONTH', severity: 'WARNING', message: 'Joined on 2026-11-16; paid for 15 of 30 days' }]);
      expect(amounts(row('NEW'))).toEqual([22500, 3418, 1500, 563, 500, 5981]); // half of each, to Re. 1
      expect((await call('get', `/periods/${await addPeriod(11, 'BONUS')}/allowances`)).status).toBe(400);
      expect((await call('get', '/periods/999999/allowances')).status).toBe(404);
    });

    it('resolves one employee on a date, with a fixed HRA amount and a CCA rate', async () => {
      await setUp();
      const e = await addEmployee('E1', des.assistant, branch.OP, 22500);
      const r = (await call('get', `/rates/hra-cca/resolve?employeeId=${e}&asOn=2026-11-30`)).body;
      expect(r).toMatchObject({ method: 'FIXED_AMOUNT', hra: { kind: 'FIXED', amount: '2500' }, cca: { kind: 'PERCENT', percent: '3.00' } });
    });
  });
});
