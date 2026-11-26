/**
 * Payroll Preparation against a real PostgreSQL (specs/08 §15). Set TEST_DATABASE_URL to a migrated database whose
 * name ends in `_test` (its employees, designations and payroll data are wiped); skipped when unset.
 */
import type { Express } from 'express';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { AuthUser, Role } from '../src/models/auth';

const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)('payroll preparation API', () => {
  let app: Express;
  let pool: typeof import('../src/config/db').pool;
  let clearSettingsCache: () => void;
  const token: Record<'maker' | 'checker' | 'hr' | 'admin' | 'branch', string> = { maker: '', checker: '', hr: '', admin: '', branch: '' };
  let branchId: number;
  let des: number;
  const leave: Record<string, number> = {};

  const user = (username: string, roles: Role[], o: Partial<AuthUser> = {}): AuthUser => ({
    id: '00000000-0000-0000-0000-000000000003', username, fullName: username, branchId: 1, branchType: 'HO',
    allBranches: true, employeeId: null, isAdmin: false, mustChangePassword: false, roles, modules: {}, ...o,
  });
  const call = (method: 'get' | 'post' | 'put' | 'delete', path: string, body?: object, t = token.maker) => {
    const r = request(app)[method](`/api/payroll${path}`).set('Authorization', `Bearer ${t}`);
    return body ? r.send(body) : r;
  };
  const one = async (text: string, values: unknown[] = []) => Number((await pool.query(text, values)).rows[0].id);
  const rows = async (text: string, values: unknown[] = []) => (await pool.query(text, values)).rows;
  const wipe = async () => {
    await pool.query(`
      delete from payroll.payrolls; delete from payroll.payroll_component_assignments; delete from payroll.payroll_hra_amounts; delete from payroll.payroll_hra_cca_rates;
      delete from payroll.payroll_periods; delete from payroll.payroll_da_rates; delete from payroll.payroll_pf_deduction_rates;
      delete from core.app_settings where key in ('payroll.hra_cca.basis', 'payroll.medical_allowance.amount');
      delete from hr.employee_transfers; delete from hr.employee_promotions;
      delete from hr.employee_service_histories; delete from hr.employees; delete from hr.employee_designations;
      delete from audit.activity_logs`);
    clearSettingsCache();
  };
  const addEmployee = (code: string, basic = 22500, joined = '2020-06-01', left: string | null = null) =>
    one(`insert into hr.employees (employee_code, employee_name, gender, designation_id, branch_id, increment_month, basic_salary, date_of_joining, date_of_leaving, created_by)
         values ($1::text, 'Name ' || $1::text, 'M', $2, $3, 7, $4, $5, $6, 'test') returning id`, [code, des, branchId, basic, joined, left]);
  const assign = (employeeId: number, code: string, amount: number, from = '2026-04-01') =>
    one(`insert into payroll.payroll_component_assignments (employee_id, component_id, assigned_type, assigned_amount, effective_from, created_by)
         select $1, id, 'FIXED', $2, $3, 'test' from payroll.payroll_components where component_code = $4 returning id`, [employeeId, amount, from, code]);
  const component = (code: string) => one('select id from payroll.payroll_components where component_code = $1', [code]);
  const addPeriod = (month = 11, workingDays: number | null = 22, status = 'OPEN') => {
    const to = new Date(Date.UTC(2026, month, 0)).toISOString().slice(0, 10);
    return one(`insert into payroll.payroll_periods (month, calendar_year, from_date, to_date, payroll_type, payroll_status, working_days, branch_id, financial_year_id, created_by)
                select $1, 2026, $2, $3, 'SALARY', $6, $5, $4, id, 'test' from core.financial_years where year_code = '2026-2027' returning id`,
      [month, `2026-${String(month).padStart(2, '0')}-01`, to, branchId, workingDays, status]);
  };
  const prepare = (periodId: number, t = token.maker) => call('post', '/payrolls/compute', { periodId, confirmAttendance: true }, t);
  const approve = (periodId: number, t = token.checker) => call('post', '/payrolls/approve-run', { periodId }, t);
  const grid = async (periodId: number) => (await call('get', `/payrolls/preparation/${periodId}`)).body;
  const billOf = (g: { bills: Array<Record<string, any>> }, code: string) => g.bills.find((b) => b.employee_code === code)!;
  const snapshot = (periodId: number) =>
    rows(`select e.employee_code, b.gross_earnings, b.total_deductions, b.net_salary, b.service_days, b.payable_days, b.issues,
            (select json_agg(json_build_array(c.component_code, l.allowance_amount, l.deduction_amount, l.applied) order by l.id) from payroll.payroll_details l
              join payroll.payroll_components c on c.id = l.component_id where l.payroll_id = b.id) as lines
          from payroll.payrolls b join hr.employees e on e.id = b.employee_id where b.payroll_period_id = $1 order by 1`, [periodId]);

  beforeAll(async () => {
    if (!/_test$/.test(new URL(url!).pathname)) throw new Error('TEST_DATABASE_URL must name a database ending in _test');
    Object.assign(process.env, { NODE_ENV: 'test', DATABASE_URL: url, JWT_SECRET: 'test-secret-test-secret-test-secret-1234', MODULES_ENABLED: 'hr,payroll' });
    const [{ buildApp }, dbMod, tokens, settings] = await Promise.all([
      import('../src/app'), import('../src/config/db'), import('../src/services/auth/tokenService'), import('../src/lib/settings'),
    ]);
    app = buildApp();
    pool = dbMod.pool;
    clearSettingsCache = settings.clearSettingsCache;
    token.maker = tokens.signAccessToken(user('maker', ['Payroll'])).token;
    token.checker = tokens.signAccessToken(user('checker', ['Payroll'])).token;
    token.hr = tokens.signAccessToken(user('hr', ['HR'])).token;
    token.admin = tokens.signAccessToken(user('boss', [], { isAdmin: true })).token;
    token.branch = tokens.signAccessToken(user('outside', ['Payroll'], { branchType: 'BRANCH' })).token;

    await pool.query(`insert into core.place_categories (code, name, created_by) values ('GCC', 'Greater Chennai Corporation', 'test') on conflict (code) do nothing`);
    await pool.query(`insert into core.branches (code, name, type, place_id, created_by) select 'PR-GCC', 'Prep branch', 'BRANCH', id, 'test' from core.place_categories where code = 'GCC' on conflict (code) do nothing`);
    await pool.query(`insert into core.branches (code, name, type, created_by) select 'PR-HO', 'Head Office', 'HO', 'test' where not exists (select 1 from core.branches where type = 'HO')`);
    branchId = await one(`select id from core.branches where code = 'PR-GCC'`);
    await pool.query(`insert into core.financial_years (year_code, short_code, start_date, end_date, created_by) values ('2026-2027', '26-27', '2026-04-01', '2027-03-31', 'test') on conflict do nothing`);
    for (const [c, t] of [['BASIC', 1], ['PP', 1], ['GP', 1], ['SP', 1], ['DA', 1], ['HRA', 1], ['CCA', 1], ['MA', 1], ['EMPLOYER_PF', 1], ['PF', 2], ['ADL PF', 2], ['TLIC', 2], ['TLOAN', 3]] as const)
      await pool.query(`insert into payroll.payroll_components (component_name, component_code, component_type, created_by) values ($1::text, $1::text, $2, 'test') on conflict do nothing`, [c, t]);
    for (const [code, name, factor, cuts] of [['CL', 'Casual Leave', 0, false], ['ML', 'Medical Leave', 0.5, false], ['LOP', 'Loss of Pay', 1, true]] as const) {
      await pool.query(`insert into hr.employee_leave_types (leave_code, leave_name, pay_cut_factor, cuts_special_pay_and_da) values ($1, $2, $3, $4) on conflict do nothing`, [code, name, factor, cuts]);
      leave[code] = await one('select id from hr.employee_leave_types where leave_code = $1', [code]);
    }
  });
  afterAll(async () => {
    if (!pool) return;
    await wipe();
    await pool.query(`delete from payroll.payroll_components where component_code in ('TLIC', 'TLOAN'); delete from core.branches where code in ('PR-GCC', 'PR-HO')`);
    await pool.end();
  });
  beforeEach(async () => {
    await wipe();
    des = await one(`insert into hr.employee_designations (designation_name, seniority_order, created_by) values ('Assistant', 1, 'test') returning id`);
    await pool.query(`
      insert into core.app_settings (module, key, value, created_by) values ('payroll', 'payroll.hra_cca.basis', '"FIXED_AMOUNT"', 'test'), ('payroll', 'payroll.medical_allowance.amount', '1000', 'test');
      insert into payroll.payroll_da_rates (effective_from, da_percentage, created_by) values ('2026-04-01', 30.38, 'test');
      insert into payroll.payroll_pf_deduction_rates (effective_from, pf_deduction_percentage, created_by) values ('2026-04-01', 12, 'test');
      insert into payroll.payroll_hra_cca_rates (place_id, effective_from, cca_percentage, cca_minimum_amount, cca_maximum_amount, created_by)
        select id, '2026-04-01', 5, 1000, 1500, 'test' from core.place_categories where code = 'GCC'`);
    await pool.query(`insert into payroll.payroll_hra_amounts (designation_id, gcc_amount, other_amount, effective_from, created_by) values ($1, 3000, 2500, '2026-04-01', 'test')`, [des]);
    clearSettingsCache();
  });

  describe('access and period', () => {
    it('opens on the earliest SALARY period not locked, and opens the next month when all are locked', async () => {
      expect((await call('post', '/periods/resolve-active')).status).toBe(409);
      await addPeriod(9, 20, 'LOCKED');
      const next = await call('post', '/periods/resolve-active');
      expect(next.body).toMatchObject({ month: 10, calendar_year: 2026, payroll_status: 'OPEN' });
      await addPeriod(11);
      expect((await call('post', '/periods/resolve-active')).body.id).toBe(next.body.id);
      expect(await rows('select 1 from payroll.payroll_periods')).toHaveLength(3);
    });

    it('HR can see and change nothing; a branch user cannot open it', async () => {
      const e = await addEmployee('E1');
      const p = await addPeriod();
      await prepare(p);
      const b = billOf(await grid(p), 'E1').id;
      for (const path of [`/payrolls/preparation/${p}`, `/payrolls/${b}`, `/readiness/${p}`, `/period-attendance/${p}`, `/period-deductions/${p}`, `/manual-deductions/${p}/${e}`]) {
        expect((await call('get', path, undefined, token.hr)).status).toBe(200);
        expect((await call('get', path, undefined, token.branch)).status).toBe(403);
      }
      const writes: Array<['post' | 'put', string, object]> = [
        ['post', '/periods/resolve-active', {}], ['post', '/payrolls/compute', { periodId: p }], ['post', '/payrolls/approve-run', { periodId: p }],
        ['post', `/periods/${p}/reject`, { reason: 'x' }], ['put', `/payrolls/${b}/withhold`, { withheld: true }],
        ['put', `/period-attendance/${p}`, { entries: [{ employeeId: e }] }], ['put', `/period-deductions/${p}`, { entries: [] }], ['put', `/manual-deductions/${p}/${e}`, { entries: [] }],
      ];
      for (const [m, path, body] of writes) expect((await call(m, path, body, token.hr)).status).toBe(403);
      expect((await call('post', `/periods/${p}/reverse-approval`, { reason: 'x' })).status).toBe(403);
    });
  });

  describe('prepare', () => {
    it('is refused without working days, on an approved or locked period, and for other pay types', async () => {
      await addEmployee('E1');
      expect((await prepare(await addPeriod(5, null))).body.error.message).toContain('Set the Working Days');
      expect((await prepare(await addPeriod(6, 20, 'APPROVED'))).status).toBe(409);
      expect((await prepare(await addPeriod(7, 20, 'LOCKED'))).status).toBe(409);
      const bonus = await addPeriod(8);
      await pool.query(`update payroll.payroll_periods set payroll_type = 'BONUS' where id = $1`, [bonus]);
      expect((await prepare(bonus)).status).toBe(400);
      expect((await prepare(999999)).status).toBe(404);
    });

    it('asks before preparing employees without an attendance entry', async () => {
      const e = await addEmployee('E1');
      await addEmployee('E2');
      const p = await addPeriod();
      await call('put', `/period-attendance/${p}`, { entries: [{ employeeId: e, headQuarters: 20 }] });
      const r = await call('post', '/payrolls/compute', { periodId: p });
      expect(r.body.error).toMatchObject({ code: 'CONFIRM_ATTENDANCE', details: { missing: 1, total: 2 } });
      expect((await grid(p)).bills).toHaveLength(0);
      expect((await prepare(p)).body).toMatchObject({ bills: 2, errors: 0 });
    });

    it('pays everyone, with totals that equal the lines, and agrees with the Allowance Preview', async () => {
      const e = await addEmployee('E1', 1);
      await assign(e, 'BASIC', 20000);
      await assign(e, 'PP', 500);
      await assign(e, 'GP', 2000);
      await assign(e, 'SP', 700);
      await assign(e, 'TLIC', 1200);
      await addEmployee('NEW', 22500, '2026-11-16');
      await addEmployee('LEFT', 22500, '2020-01-01', '2026-11-10');
      await addEmployee('LATER', 22500, '2026-12-01');
      await addEmployee('GONE', 22500, '2020-01-01', '2026-10-31');
      const p = await addPeriod();
      expect((await prepare(p)).body).toMatchObject({ bills: 3, errors: 0 });
      const g = await grid(p);
      expect(g.period).toMatchObject({ payroll_status: 'PROCESSED', processed_by: 'maker' });
      const b = billOf(g, 'E1');
      expect(b.amounts).toMatchObject({ basic: '20000.00', pp: '500.00', gp: '2000.00', sp: '700.00', pay: '22700.00', da: '6836.00', hra: '3000.00', cca: '1125.00', ma: '1000.00', pf: '3520.00', employerPf: '3520.00', otherDeductions: '1200.00' });
      expect([b.gross_earnings, b.total_deductions, b.net_salary]).toEqual(['38681.00', '8240.00', '30441.00']);
      expect([billOf(g, 'NEW').payable_days, billOf(g, 'LEFT').payable_days]).toEqual(['15.00', '10.00']);
      const preview = (await call('get', `/periods/${p}/allowances`)).body.employees;
      for (const x of preview) expect([x.employeeCode, x.da, x.hra, x.cca, x.ma]).toEqual([x.employeeCode, ...['da', 'hra', 'cca', 'ma'].map((k) => billOf(g, x.employeeCode).amounts[k])]);
      const bad = await rows(`select 1 from payroll.payrolls b left join (select payroll_id, sum(allowance_amount) a, sum(deduction_amount) d from payroll.payroll_details group by 1) l on l.payroll_id = b.id
                              where b.gross_earnings <> l.a or b.total_deductions <> l.d or b.net_salary <> l.a - l.d`);
      expect(bad).toEqual([]);
      const detail = (await call('get', `/payrolls/${b.id}`)).body;
      expect(detail.lines.find((l: { component_code: string }) => l.component_code === 'DA').applied).toMatchObject({ percentage: '30.38' });
      expect(detail.lines.find((l: { component_code: string }) => l.component_code === 'HRA').applied.segments[0]).toMatchObject({ kind: 'FIXED', amount: '3000', days: 30 });
      expect(g.changed).toEqual([]);
    });

    it('prints payslips: one employee with the basis of each line, a branch, or all; draft until approved', async () => {
      const e = await addEmployee('E1');
      await assign(e, 'BASIC', 20000);
      await assign(e, 'SP', 700);
      await assign(e, 'TLIC', 1200);
      await addEmployee('E2');
      const p = await addPeriod();
      await call('put', `/period-attendance/${p}`, { entries: [{ employeeId: e, headQuarters: 18, camp: 2, leaves: [{ leaveTypeId: leave.LOP, days: 2 }] }] });
      expect((await prepare(p)).body).toMatchObject({ bills: 2, errors: 0 });

      const one = (await call('get', `/payrolls/preparation/${p}/payslips?employeeId=${e}`)).body;
      expect(one).toMatchObject({ preparedBy: 'maker', period: { id: p } });
      expect(one.slips).toHaveLength(1);
      const s = one.slips[0];
      expect(s).toMatchObject({ draft: true, employee: { code: 'E1', designation: 'Assistant', branch: 'Prep branch' } });
      expect(s.attendance).toMatchObject({ calendarDays: 30, workingDays: 22, payDays: 28, lop: 2, hq: 18, camp: 2, entered: true, leaves: [{ code: 'LOP', days: 2 }] });
      const basis = Object.fromEntries([...s.earnings, ...s.deductions].map((l: { label: string; basis: string }) => [l.label, l.basis]));
      expect(basis).toMatchObject({ 'Basic Pay': '28/30 days', 'Special Pay': '28/30 days', 'Dearness Allowance': '30.38% · 28/30 days', 'House Rent Allowance': 'Fixed 3,000', 'Employer PF (Dr)': 'Equal to PF' });
      expect(basis['Provident Fund']).toMatch(/^12% of /);
      const sum = (list: Array<{ amount: string }>) => list.reduce((n, l) => n + Number(l.amount), 0).toFixed(2);
      expect([sum(s.earnings), sum(s.deductions)]).toEqual([s.gross, s.deductionsTotal]);
      expect(s.netInWords).toMatch(/^Rupees .* Only$/);

      expect((await call('get', `/payrolls/preparation/${p}/payslips?branchId=${branchId}`)).body.slips).toHaveLength(2);
      expect((await call('get', `/payrolls/preparation/${p}/payslips?employeeId=999999`)).status).toBe(404);
      expect((await call('get', `/payrolls/preparation/${p}/payslips`, undefined, token.branch)).status).toBe(403);
      expect((await approve(p)).status).toBe(200);
      const all = (await call('get', `/payrolls/preparation/${p}/payslips`)).body.slips;
      expect(all.map((x: { draft: boolean; approvedBy: string }) => [x.draft, x.approvedBy])).toEqual([[false, 'checker'], [false, 'checker']]);
    });

    it('gives the same bills twice, and keeps entries, edits and withheld marks', async () => {
      const e = await addEmployee('E1');
      await assign(e, 'TLIC', 1200);
      await assign(e, 'TLOAN', 900);
      const p = await addPeriod();
      await call('put', `/period-attendance/${p}`, { entries: [{ employeeId: e, remarks: 'ok', leaves: [{ leaveTypeId: leave.LOP, days: 3 }] }] });
      await call('put', `/period-deductions/${p}`, { entries: [{ employeeId: e, componentId: await component('TLOAN'), amount: 450 }] });
      await prepare(p);
      await call('put', `/manual-deductions/${p}/${e}`, { entries: [{ componentId: await component('TLIC'), amount: 1000.5 }] });
      await call('put', `/payrolls/${billOf(await grid(p), 'E1').id}/withhold`, { withheld: true, reason: 'Vigilance' });
      const before = await snapshot(p);
      expect((await prepare(p, token.checker)).status).toBe(200);
      expect(await snapshot(p)).toEqual(before);
      const b = billOf(await grid(p), 'E1');
      expect(b).toMatchObject({ is_withheld: true, withhold_reason: 'Vigilance', payable_days: '27.00' });
      expect(Object.fromEntries(before[0].lines.map((l: [string, number, number]) => [l[0], l[2] || l[1]]))).toMatchObject({ BASIC: 20250, DA: 6152, TLIC: 1000.5, TLOAN: 450 });
      expect((await grid(p)).period.processed_by).toBe('checker'); // the maker is whoever prepared last
    });

    it('changes nothing when it fails', async () => {
      await addEmployee('E1');
      const p = await addPeriod();
      await prepare(p);
      const before = await snapshot(p);
      await pool.query(`update payroll.payroll_da_rates set da_percentage = 40`);
      // A failure in the middle of writing the lines.
      await pool.query(`alter table payroll.payroll_details add constraint boom check (allowance_amount <> 9000)`); // 40% of 22,500
      try {
        expect((await prepare(p)).status).toBe(400);
      } finally {
        await pool.query('alter table payroll.payroll_details drop constraint boom');
      }
      expect(await snapshot(p)).toEqual(before);
    });
  });

  describe('approve, reject, reverse, lock', () => {
    it('the maker cannot approve or reject; a checker can; Admin may approve their own', async () => {
      await addEmployee('E1');
      const p = await addPeriod();
      expect((await approve(p)).body.error.message).toContain('Prepare the payroll first');
      await prepare(p);
      expect((await approve(p, token.maker)).status).toBe(403);
      expect((await call('post', `/periods/${p}/reject`, { reason: 'x' }, token.maker)).status).toBe(403);
      expect((await call('post', `/periods/${p}/reject`, { reason: ' ' }, token.checker)).status).toBe(400);
      expect((await call('post', `/periods/${p}/reject`, { reason: 'LIC list missing' }, token.checker)).body).toMatchObject({ payroll_status: 'OPEN', returned_by: 'checker', return_reason: 'LIC list missing', bill_count: 1 });
      await prepare(p, token.admin);
      expect((await grid(p)).period.return_reason).toBeNull();
      expect((await call('post', `/periods/${p}/reject`, { reason: 'x' }, token.admin)).status).toBe(403);
      expect((await approve(p, token.admin)).body).toMatchObject({ payroll_status: 'APPROVED', approved_by: 'boss' });
      expect((await rows('select payroll_status, approved_by from payroll.payrolls'))[0]).toEqual({ payroll_status: 'APPROVED', approved_by: 'boss' });
      const log = await rows(`select event_type, user_name from audit.activity_logs where category = 'APPROVAL' order by id`);
      expect(log.map((l) => [l.event_type, l.user_name])).toEqual([['SUBMITTED', 'maker'], ['REJECTED', 'checker'], ['SUBMITTED', 'boss'], ['APPROVED', 'boss']]);
    });

    it('is refused when anything changed after Prepare, until prepared again', async () => {
      const e = await addEmployee('E1');
      await assign(e, 'TLIC', 1200);
      const p = await addPeriod();
      const lic = await component('TLIC');
      const changes: Array<[string, () => Promise<unknown>]> = [
        ['DA rate', () => pool.query('update payroll.payroll_da_rates set da_percentage = 31.5')],
        ['assignment', () => pool.query('update payroll.payroll_component_assignments set assigned_amount = 1300')],
        ['attendance', () => call('put', `/period-attendance/${p}`, { entries: [{ employeeId: e, leaves: [{ leaveTypeId: leave.LOP, days: 1 }] }] })],
        ['agency amount', () => call('put', `/period-deductions/${p}`, { entries: [{ employeeId: e, componentId: lic, amount: 0 }] })],
        ['medical allowance', () => pool.query(`update core.app_settings set value = '1100' where key = 'payroll.medical_allowance.amount'`)],
        ['new employee', () => addEmployee('E2')],
        ['leaving date', () => pool.query(`update hr.employees set date_of_leaving = '2026-11-20' where employee_code = 'E2'`)],
        ['gone before the period', () => pool.query(`update hr.employees set date_of_leaving = '2026-10-20' where employee_code = 'E2'`)],
      ];
      await prepare(p);
      for (const [what, change] of changes) {
        await change();
        const r = await approve(p);
        expect([what, r.status, r.body.error?.code]).toEqual([what, 409, 'STALE_RUN']);
        expect((await grid(p)).changed).toHaveLength(1);
        await prepare(p);
        expect((await grid(p)).changed).toEqual([]);
      }
      expect((await approve(p)).status).toBe(200);
    });

    it('lists errors by employee and blocks approval', async () => {
      await addEmployee('E1', 0);
      await pool.query('delete from payroll.payroll_pf_deduction_rates');
      const p = await addPeriod();
      expect((await prepare(p)).body.errors).toBeGreaterThan(1);
      const b = billOf(await grid(p), 'E1');
      expect(b.issues.map((i: { code: string }) => i.code)).toEqual(expect.arrayContaining(['BASIC_PAY', 'PF_RATE']));
      const r = await approve(p);
      expect(r.body.error.code).toBe('RUN_HAS_ERRORS');
      expect(r.body.error.details.employees[0]).toMatchObject({ employeeCode: 'E1', employeeName: 'Name E1' });
    });

    it('freezes inputs and bills once approved; Admin can reverse until something is paid', async () => {
      const e = await addEmployee('E1');
      await assign(e, 'TLIC', 1200);
      const p = await addPeriod();
      await prepare(p);
      await approve(p);
      const frozen = [
        await prepare(p), await call('put', `/periods/${p}/working-days`, { workingDays: 10 }),
        await call('put', `/period-attendance/${p}`, { entries: [{ employeeId: e, camp: 1 }] }),
        await call('put', `/period-deductions/${p}`, { entries: [{ employeeId: e, componentId: await component('TLIC'), amount: 1 }] }),
        await call('put', `/manual-deductions/${p}/${e}`, { entries: [] }),
        await call('post', `/periods/${p}/reject`, { reason: 'x' }, token.checker), await approve(p),
      ];
      expect(frozen.map((r) => r.status)).toEqual(Array(7).fill(409));
      const back = await call('post', `/periods/${p}/reverse-approval`, { reason: 'Wrong DA' }, token.admin);
      expect(back.body).toMatchObject({ payroll_status: 'PROCESSED', approved_by: null, return_reason: 'Wrong DA' });
      expect((await grid(p)).bills[0].payroll_status).toBe('DRAFT');
      await approve(p);
      await pool.query(`update payroll.payrolls set payroll_status = 'PAID'`);
      expect((await call('post', `/periods/${p}/reverse-approval`, { reason: 'x' }, token.admin)).status).toBe(409);
      expect((await call('put', `/payrolls/${(await grid(p)).bills[0].id}/withhold`, { withheld: true })).body.error.message).toBe('This pay bill is already paid.');
    });

    it('lock is refused while an approved bill that is not withheld is unpaid', async () => {
      await addEmployee('E1');
      const p = await addPeriod();
      await prepare(p);
      await approve(p);
      expect((await call('post', `/periods/${p}/lock-and-roll`)).status).toBe(409);
      expect((await grid(p)).summary).toMatchObject({ pending: { count: 1 }, withheld: { count: 0 } });
      const id = (await grid(p)).bills[0].id;
      expect((await call('put', `/payrolls/${id}/withhold`, { withheld: true })).status).toBe(200);
      expect((await call('post', `/periods/${p}/lock-and-roll`)).body.next).toMatchObject({ month: 12, payroll_status: 'OPEN' });
      expect((await call('put', `/payrolls/${id}/withhold`, { withheld: false })).body.error.message).toContain('locked');
    });

    it('a rejected period keeps its dates', async () => {
      await addEmployee('E1');
      const p = await addPeriod();
      await prepare(p);
      await call('post', `/periods/${p}/reject`, { reason: 'x' }, token.checker);
      const body = { payrollType: 'SALARY', month: 11, calendarYear: 2026, fromDate: '2026-11-01', toDate: '2026-11-30', branchId, daRate: 5 };
      expect((await call('put', `/periods/${p}`, body)).status).toBe(200);
      expect((await call('put', `/periods/${p}`, { ...body, toDate: '2026-11-29' })).status).toBe(409);
      expect((await call('put', `/periods/${p}`, { ...body, payrollType: 'BONUS' })).status).toBe(409);
    });
  });

  describe('monthly attendance', () => {
    it('saves, asks before replacing or deleting, and drops blank rows', async () => {
      const e = await addEmployee('E1');
      await addEmployee('E2');
      const p = await addPeriod();
      const put = (o: object, confirm = false) => call('put', `/period-attendance/${p}`, { entries: [{ employeeId: e, ...o }], confirm });
      expect((await put({})).body).toEqual({ saved: 0, removed: 0 });
      expect((await put({ headQuarters: 20, camp: 2, leaves: [{ leaveTypeId: leave.CL, days: 1 }] })).body).toEqual({ saved: 1, removed: 0 });
      expect((await put({ headQuarters: 20, camp: 2, leaves: [{ leaveTypeId: leave.CL, days: 1 }] })).body).toEqual({ saved: 0, removed: 0 }); // unchanged
      expect((await put({ headQuarters: 19 })).body.error).toMatchObject({ code: 'CONFIRM_OVERWRITE', details: { replaced: 1, removed: 0 } });
      expect((await put({ headQuarters: 19 }, true)).body).toEqual({ saved: 1, removed: 0 });
      const g = (await call('get', `/period-attendance/${p}`)).body;
      expect(g.rows.map((r: { employeeCode: string; saved: boolean; leaves: object }) => [r.employeeCode, r.saved, r.leaves])).toEqual([['E1', true, {}], ['E2', false, {}]]);
      expect((await put({})).body.error.details).toEqual({ replaced: 0, removed: 1 });
      expect((await put({}, true)).body).toEqual({ saved: 0, removed: 1 });
    });

    it('rejects fractions, unknown leave types, too many days and people not in service', async () => {
      const e = await addEmployee('E1', 22500, '2026-11-29');
      const gone = await addEmployee('GONE', 22500, '2020-01-01', '2026-10-01');
      const p = await addPeriod();
      const put = (employeeId: number, o: object) => call('put', `/period-attendance/${p}`, { entries: [{ employeeId, ...o }] });
      for (const [id, o] of [[e, { camp: 0.5 }], [e, { camp: -1 }], [e, { leaves: [{ leaveTypeId: 999999, days: 1 }] }], [e, { leaves: [{ leaveTypeId: leave.LOP, days: 3 }] }], [gone, { camp: 1 }]] as const)
        expect((await put(id, o)).status).toBe(400);
      expect(await rows('select 1 from payroll.payroll_period_attendances')).toEqual([]);
    });

    it('imports: reports rows, saves the valid ones, keeps remarks and columns not in the sheet', async () => {
      const e = await addEmployee('E1');
      await addEmployee('E2');
      const p = await addPeriod();
      await call('put', `/period-attendance/${p}`, { entries: [{ employeeId: e, remarks: 'keep', leaves: [{ leaveTypeId: leave.ML, days: 2 }] }] });
      const sheet = {
        headers: ['HQ', 'lop'],
        rows: [{ line: 2, code: 'e1', values: ['20', '1'] }, { line: 3, code: 'E2', values: ['', '0.5'] }, { line: 4, code: 'XX', values: ['', ''] }, { line: 5, code: '', values: ['1', ''] }, { line: 6, code: 'E1', values: ['1', ''] }],
      };
      const send = (o: object) => call('post', `/period-attendance/${p}/import`, { ...sheet, ...o });
      const view = (await send({ dryRun: true })).body;
      expect(view).toMatchObject({ total: 5, added: 0, overwritten: 1, errors: 4, imported: 0 });
      expect(view.rows.map((r: { error: string | null }) => r.error)).toEqual([null, "Row 3: column 'lop' is not a whole number.", "Row 4: 'XX' is not an employee in service in this period; skipped.", 'Row 5: employee code is blank.', 'Row 6: same employee as row 2.']);
      expect((await call('get', `/period-attendance/${p}`)).body.rows[0].headQuarters).toBe(0);
      expect((await send({ dryRun: false })).body.error.code).toBe('CONFIRM_OVERWRITE');
      expect((await send({ dryRun: false, confirm: true })).body.imported).toBe(1);
      expect((await call('get', `/period-attendance/${p}`)).body.rows[0]).toMatchObject({ headQuarters: 20, remarks: 'keep', leaves: { [leave.ML!]: 2, [leave.LOP!]: 1 } });
      const bad = await send({ headers: ['HQ', 'NOPE'], dryRun: true });
      expect(bad.body.error.message).toBe("Unknown column header 'NOPE'. Expected EmployeeCode, EmployeeName, HQ, Camp, or a leave code from Leave Types.");
    });
  });

  describe('agency deductions', () => {
    it('replaces the assigned amount for the month, 0 waives, clearing returns to it', async () => {
      const e = await addEmployee('E1');
      await assign(e, 'TLIC', 1200);
      await assign(e, 'ADL PF', 500);
      const p = await addPeriod();
      const lic = await component('TLIC');
      const put = (amount: number | null, confirm = true) => call('put', `/period-deductions/${p}`, { entries: [{ employeeId: e, componentId: lic, amount }], confirm });
      const deducted = async () => { await prepare(p); return (await grid(p)).bills[0].amounts.otherDeductions; };
      expect(await deducted()).toBe('1200.00');
      await put(900);
      expect(await deducted()).toBe('900.00');
      expect((await put(0, false)).body.error.code).toBe('CONFIRM_OVERWRITE');
      await put(0);
      expect(await deducted()).toBe('0.00');
      await put(null);
      expect(await deducted()).toBe('1200.00');
      const g = (await call('get', `/period-deductions/${p}`)).body;
      expect(g.rows.map((r: { componentCode: string }) => r.componentCode)).toEqual(['TLIC']); // VPF is not uploaded
      expect((await call('put', `/period-deductions/${p}`, { entries: [{ employeeId: e, componentId: await component('ADL PF'), amount: 1 }] })).status).toBe(400);
    });

    it('imports one component, with blank removing and 0 waiving', async () => {
      const ids = [];
      for (const c of ['E1', 'E2', 'E3', 'E4']) { ids.push(await addEmployee(c)); if (c !== 'E4') await assign(ids[ids.length - 1]!, 'TLIC', 1200); }
      const p = await addPeriod();
      const lic = await component('TLIC');
      await call('put', `/period-deductions/${p}`, { entries: [{ employeeId: ids[0], componentId: lic, amount: 50 }] });
      const send = (o: object) => call('post', `/period-deductions/${p}/import`, {
        componentId: lic, sheetCode: 'tlic', dryRun: false,
        rows: [{ line: 8, code: 'E1', amount: '' }, { line: 9, code: 'E2', amount: '0' }, { line: 10, code: 'E3', amount: '1,250.50' }, { line: 11, code: 'E4', amount: '5' }, { line: 12, code: 'E9', amount: 'abc' }], ...o,
      });
      expect((await send({ sheetCode: 'TLOAN' })).body.error.message).toContain("This sheet is for deduction 'TLOAN'");
      const view = (await send({ dryRun: true })).body;
      expect(view.rows.map((r: { action: string; waived: boolean }) => [r.action, r.waived])).toEqual([['REMOVE', false], ['NEW', true], ['NEW', false], [null, false], [null, false]]);
      expect((await send({})).body.error.details).toEqual({ replaced: 0, removed: 1 });
      expect((await send({ confirm: true })).body).toMatchObject({ imported: 3, errors: 2 });
      expect((await call('get', `/period-deductions/${p}`)).body.rows.map((r: { amount: string | null }) => r.amount)).toEqual([null, '0.00', '1250.50']);
      const next = await addPeriod(12);
      expect((await call('get', `/period-deductions/${next}`)).body.rows.map((r: { previous: string | null }) => r.previous)).toEqual([null, '0.00', '1250.50']);
      expect((await send({ componentId: await component('TLOAN'), sheetCode: null })).body.error.message).toContain('no eligible employees');
    });

    it('the status panel shows what will be deducted, also with no upload', async () => {
      const [a, b] = [await addEmployee('E1'), await addEmployee('E2')];
      await assign(a, 'TLIC', 1200);
      await assign(b, 'TLIC', 800);
      await assign(b, 'TLOAN', 300);
      const p = await addPeriod();
      const panel = async () => (await call('get', `/readiness/${p}`)).body;
      expect(await panel()).toMatchObject({ attendance: { status: 'NOT_UPLOADED', entered: 0, total: 2 }, message: 'Upload attendance before preparing.', agencies: [{ code: 'TLIC', uploaded: 0, eligible: 2, amount: '2000.00', employees: 2, firstUploadedAt: null }, { code: 'TLOAN' }] });
      await call('put', `/period-attendance/${p}`, { entries: [{ employeeId: a, camp: 1 }] });
      await call('put', `/period-deductions/${p}`, { entries: [{ employeeId: b, componentId: await component('TLOAN'), amount: 0 }, { employeeId: a, componentId: await component('TLIC'), amount: 100 }] });
      expect(await panel()).toMatchObject({ attendance: { status: 'PARTIAL', entered: 1 }, message: 'Ready — but check the ₹0 agencies below.', agencies: [{ uploaded: 1, amount: '900.00' }, { amount: '0.00', employees: 0 }] });
    });
  });

  describe('edit deductions', () => {
    it('previews, saves with a new Prepare, and reports an edit whose deduction has ended', async () => {
      const e = await addEmployee('E1');
      const a = await assign(e, 'TLIC', 1200);
      const p = await addPeriod();
      const path = `/manual-deductions/${p}/${e}`;
      expect((await call('get', path)).body.error.message).toContain('No prepared payroll row');
      await prepare(p);
      const before = (await call('get', path)).body;
      expect(before).toMatchObject({ gross: '34461.00', minimumNet: '8615.00' });
      expect(before.rows.map((r: { componentCode: string; calculated: string }) => [r.componentCode, r.calculated])).toEqual([['PF', '3520.00'], ['TLIC', '1200.00']]);
      const lic = await component('TLIC');
      expect((await call('put', path, { entries: [{ componentId: lic, amount: 1000, remarks: 'MD order' }] })).body.bills).toBe(1);
      expect((await grid(p)).bills[0].amounts.otherDeductions).toBe('1000.00');
      expect((await call('get', path)).body.rows[1]).toMatchObject({ calculated: '1200.00', override: '1000.00', remarks: 'MD order' });
      expect((await call('put', path, { entries: [{ componentId: await component('TLOAN'), amount: 5 }] })).status).toBe(400);

      await pool.query(`update payroll.payroll_component_assignments set effective_to = '2026-10-31' where id = $1`, [a]);
      await prepare(p);
      const g = await grid(p);
      expect(g.bills[0].amounts.otherDeductions).toBe('0.00');
      expect(g.bills[0].issues.map((i: { code: string }) => i.code)).toContain('OVERRIDE');
      expect((await call('get', path)).body.rows[1]).toMatchObject({ calculated: null, override: '1000.00', applies: false });
      await call('put', path, { entries: [{ componentId: lic, amount: null }] });
      expect((await grid(p)).bills[0].issues.map((i: { code: string }) => i.code)).not.toContain('OVERRIDE');
    });

    it('a negative net blocks approval', async () => {
      const e = await addEmployee('E1');
      await assign(e, 'TLIC', 90000);
      const p = await addPeriod();
      await prepare(p);
      expect((await grid(p)).bills[0].issues.map((i: { code: string }) => i.code)).toContain('NET_NEGATIVE');
      expect((await approve(p)).body.error.code).toBe('RUN_HAS_ERRORS');
    });
  });
});
