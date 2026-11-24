/**
 * Grades API against a real PostgreSQL. Set TEST_DATABASE_URL to a migrated database whose name ends in
 * `_test` (its grades and designations are wiped); skipped when unset.
 */
import type { Express } from 'express';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { AuthUser, Role } from '../src/models/auth';

const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)('grades API', () => {
  let app: Express;
  let pool: typeof import('../src/config/db').pool;
  let sign: typeof import('../src/services/auth/tokenService').signAccessToken;
  let token: string;

  const userWith = (roles: Role[]): AuthUser => ({
    id: '00000000-0000-0000-0000-000000000001', username: 'tester', fullName: 'Tester', branchId: 1, branchType: 'HO',
    allBranches: true, employeeId: null, isAdmin: false, mustChangePassword: false, roles, modules: { '12000010': 'MC' },
  });
  type Method = 'get' | 'post' | 'put' | 'delete';
  const call = (method: Method, path: string, body?: object) => {
    const r = request(app)[method](`/api/hr${path}`).set('Authorization', `Bearer ${token}`);
    return body ? r.send(body) : r;
  };
  const addGrade = async (body: object) => {
    const r = await call('post', '/grades', body);
    expect(r.status).toBe(201);
    return r.body as { id: number; grade_code: string };
  };
  const addDesignation = async (designationName: string, grade?: string) => {
    const r = await call('post', '/designations', { designationName, grade });
    expect(r.status).toBe(201);
    return r.body as { id: number; grade: string | null };
  };
  const gradeOf = async (id: number) => (await call('get', `/designations/${id}`)).body.grade;

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
    sign = tokens.signAccessToken;
    token = sign(userWith(['HR'])).token;
  });
  afterAll(async () => { await pool?.end(); });
  beforeEach(async () => { await pool.query('delete from hr.employee_grades; delete from hr.employee_designations'); });

  it('creates a grade and reads every field back', async () => {
    const g = await addGrade({ gradeCode: ' G1 ', description: 'Officers', displayOrder: 5, isActive: false });
    const r = await call('get', `/grades/${g.id}`);
    expect(r.body).toMatchObject({ grade_code: 'G1', description: 'Officers', display_order: 5, is_active: false, created_by: 'tester', usage_count: 0 });
  });

  it('rejects a duplicate code ignoring case and outer spaces, on create and update', async () => {
    await addGrade({ gradeCode: 'Grade A' });
    const b = await addGrade({ gradeCode: 'B' });
    for (const r of [await call('post', '/grades', { gradeCode: ' gRADE a ' }), await call('put', `/grades/${b.id}`, { gradeCode: 'GRADE A' })]) {
      expect(r.status).toBe(409);
      expect(r.body.error.details.gradeCode[0]).toBe("Grade 'Grade A' already exists");
    }
  });

  it('rejects invalid input with 400', async () => {
    expect((await call('post', '/grades', { gradeCode: ' ' })).status).toBe(400);
    expect((await call('post', '/grades', { gradeCode: 'G1', displayOrder: 1000 })).status).toBe(400);
  });

  it('updates fields, clears optional ones, and keeps isActive when omitted', async () => {
    const g = await addGrade({ gradeCode: 'G1', description: 'x', displayOrder: 1, isActive: false });
    const r = await call('put', `/grades/${g.id}`, { gradeCode: 'G1' });
    expect(r.body).toMatchObject({ grade_code: 'G1', description: null, display_order: null, is_active: false, updated_by: 'tester' });
  });

  it('renaming a grade updates its designations and nothing else', async () => {
    const g = await addGrade({ gradeCode: 'G1' });
    const [a, b, other] = [await addDesignation('A', 'G1'), await addDesignation('B', 'g1'), await addDesignation('C', 'G2')];
    const r = await call('put', `/grades/${g.id}`, { gradeCode: 'G-1' });
    expect(r.body.usage_count).toBe(2);
    expect([await gradeOf(a.id), await gradeOf(b.id), await gradeOf(other.id)]).toEqual(['G-1', 'G-1', 'G2']);
    await addGrade({ gradeCode: 'G1' }); // the old code is free again
  });

  it('a rejected rename leaves designations unchanged', async () => {
    const g = await addGrade({ gradeCode: 'G1' });
    await addGrade({ gradeCode: 'G2' });
    const d = await addDesignation('A', 'G1');
    expect((await call('put', `/grades/${g.id}`, { gradeCode: 'g2' })).status).toBe(409);
    expect(await gradeOf(d.id)).toBe('G1');
  });

  it('an update that keeps the code does not rewrite designation spellings', async () => {
    const g = await addGrade({ gradeCode: 'G1' });
    const d = await addDesignation('A', 'g1');
    await call('put', `/grades/${g.id}`, { gradeCode: 'G1', description: 'new' });
    expect(await gradeOf(d.id)).toBe('g1');
  });

  it('blocks deleting a used grade (inactive designations count too) and deletes an unused one', async () => {
    const g = await addGrade({ gradeCode: 'G1' });
    const d = await addDesignation('A', 'g1');
    await call('delete', `/designations/${d.id}`); // deactivates
    const blocked = await call('delete', `/grades/${g.id}`);
    expect(blocked.status).toBe(409);
    expect(blocked.body.error.message).toMatch(/used by 1 designation.*Deactivate it instead/);
    await call('put', `/designations/${d.id}`, { designationName: 'A' });
    expect((await call('delete', `/grades/${g.id}`)).status).toBe(204);
    expect((await call('get', `/grades/${g.id}`)).status).toBe(404);
  });

  it('lists by display order then code; active=true hides inactive grades', async () => {
    await addGrade({ gradeCode: 'Z', displayOrder: 1 });
    await addGrade({ gradeCode: 'B' });
    await addGrade({ gradeCode: 'A' });
    await addGrade({ gradeCode: 'Off', displayOrder: 2, isActive: false });
    const codes = async (qs: string) => (await call('get', `/grades${qs}`)).body.map((g: { grade_code: string }) => g.grade_code);
    expect(await codes('')).toEqual(['Z', 'Off', 'A', 'B']);
    expect(await codes('?active=true')).toEqual(['Z', 'A', 'B']);
  });

  it('designations still accept no grade, and a grade not in the master', async () => {
    expect((await addDesignation('A')).grade).toBeNull();
    expect((await addDesignation('B', 'Legacy')).grade).toBe('Legacy');
  });

  it('writes an audit row for each change', async () => {
    const g = await addGrade({ gradeCode: 'G1' });
    await call('delete', `/grades/${g.id}`);
    const { rows } = await pool.query(
      `select operation, user_name from audit.row_changes where table_name = 'employee_grades' and row_pk = $1 order by id`, [String(g.id)]);
    expect(rows).toEqual([{ operation: 'INSERT', user_name: 'tester' }, { operation: 'DELETE', user_name: 'tester' }]);
  });

  it('404 for unknown ids, 401 without a token, 403 for Payroll users', async () => {
    expect((await call('put', '/grades/999999', { gradeCode: 'X' })).status).toBe(404);
    expect((await call('delete', '/grades/999999')).status).toBe(404);
    expect((await request(app).get('/api/hr/grades')).status).toBe(401);
    const payroll = sign(userWith(['Payroll'])).token;
    expect((await request(app).get('/api/hr/grades').set('Authorization', `Bearer ${payroll}`)).status).toBe(403);
  });
});
