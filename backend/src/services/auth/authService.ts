import bcrypt from 'bcryptjs';
import { db } from '../../config/db';
import { env } from '../../config/env';
import { withAudit, type Actor } from '../../lib/dbContext';
import { AppError } from '../../lib/errors';
import { ModuleIds, Roles, type AuthUser, type ModuleGrant, type Role } from '../../models/auth';
import { logActivity } from '../core/activityLogService';
import { verifyCaptcha } from './captchaService';
import { hashToken, newRefreshToken, signAccessToken } from './tokenService';

// ASP.NET Identity defaults used by TNCU: lock after 5 failures for 5 minutes.
const MAX_FAILED = 5;
const LOCKOUT_MS = 5 * 60_000;

/** TNCU password policy: ≥ 8 chars, at least one digit and one uppercase letter. */
export const PASSWORD_RULE = /^(?=.*\d)(?=.*[A-Z]).{8,}$/;

export interface TokenPair {
  accessToken: string;
  accessTokenExpiresAt: string;
  refreshToken: string;
  user: AuthUser;
}

/**
 * Build the principal. Roles are derived from module grants (TNCU ModuleAssignmentRules.DeriveRoles):
 * Maker/Checker from any grant; HR/Payroll/EPF from the module; Employee from a linked employee record.
 */
export async function buildPrincipal(userId: string): Promise<AuthUser> {
  const u = await db
    .selectFrom('auth.users as u')
    .innerJoin('core.branches as b', 'b.id', 'u.branch_id')
    .select([
      'u.id', 'u.username', 'u.full_name', 'u.branch_id', 'u.can_view_all_branches', 'u.employee_id',
      'u.is_admin', 'u.must_change_password', 'u.is_active', 'b.type as branch_type',
    ])
    .where('u.id', '=', userId)
    .executeTakeFirst();
  if (!u || !u.is_active) throw AppError.unauthorized('Account is inactive');

  const grants = await db
    .selectFrom('auth.user_modules as um')
    .innerJoin('core.menu_mains as m', 'm.id', 'um.menu_id')
    .select(['um.menu_id', 'um.is_maker', 'um.is_checker', 'm.module_key'])
    .where('um.user_id', '=', userId)
    .where('m.is_active', '=', true)
    .execute();

  const roles = new Set<Role>();
  const modules: Record<string, ModuleGrant> = {};
  if (u.is_admin) roles.add(Roles.Admin);
  for (const g of grants) {
    modules[String(g.menu_id)] = g.is_maker && g.is_checker ? 'MC' : g.is_maker ? 'M' : 'C';
    if (g.is_maker) roles.add(Roles.Maker);
    if (g.is_checker) roles.add(Roles.Checker);
    if (g.menu_id === ModuleIds.HR) roles.add(Roles.HR);
    if (g.menu_id === ModuleIds.Payroll) roles.add(Roles.Payroll);
    if (g.menu_id === ModuleIds.EPF) roles.add(Roles.EPF);
  }
  if (u.employee_id != null) roles.add(Roles.Employee);

  return {
    id: u.id,
    username: u.username,
    fullName: u.full_name,
    branchId: u.branch_id,
    branchType: u.branch_type,
    allBranches: u.can_view_all_branches,
    employeeId: u.employee_id,
    isAdmin: u.is_admin,
    mustChangePassword: u.must_change_password,
    roles: [...roles],
    modules,
  };
}

async function issueTokens(actor: Actor, userId: string, replacingId?: number): Promise<TokenPair> {
  const user = await buildPrincipal(userId);
  const access = signAccessToken(user);
  const refresh = newRefreshToken();
  await withAudit({ ...actor, user }, async (trx) => {
    const inserted = await trx
      .insertInto('auth.refresh_tokens')
      .values({ user_id: userId, token_hash: refresh.hash, expires_at: refresh.expiresAt, created_ip: actor.ctx?.ip ?? null })
      .returning('id')
      .executeTakeFirstOrThrow();
    if (replacingId) {
      await trx
        .updateTable('auth.refresh_tokens')
        .set({ revoked_at: new Date(), replaced_by: inserted.id })
        .where('id', '=', replacingId)
        .execute();
    }
  });
  return { accessToken: access.token, accessTokenExpiresAt: access.expiresAt.toISOString(), refreshToken: refresh.token, user };
}

export async function login(
  actor: Actor,
  input: { username: string; password: string; captchaId?: string; captchaAnswer?: string },
): Promise<TokenPair> {
  if (env.CAPTCHA_ENABLED && !verifyCaptcha(input.captchaId, input.captchaAnswer)) {
    throw AppError.badRequest('Captcha is incorrect or expired');
  }

  const u = await db
    .selectFrom('auth.users')
    .select(['id', 'username', 'password_hash', 'is_active', 'access_failed_count', 'lockout_end'])
    .where((eb) => eb(eb.fn('lower', ['username']), '=', input.username.trim().toLowerCase()))
    .executeTakeFirst();

  const fail = async (reason: string) => {
    await logActivity(actor, { category: 'SECURITY', eventType: 'LOGIN_FAILED', summary: reason, userName: input.username });
    return AppError.unauthorized('Invalid username or password');
  };

  if (!u || !u.is_active) throw await fail('Unknown or inactive user');
  if (u.lockout_end && new Date(u.lockout_end) > new Date()) {
    throw AppError.unauthorized('Account is temporarily locked. Try again in a few minutes.');
  }

  // Not yet authenticated: attribute the bookkeeping update to the account being signed in to.
  const self: Actor = { ctx: actor.ctx, user: { id: u.id, username: u.username } as AuthUser };

  const ok = await bcrypt.compare(input.password, u.password_hash);
  if (!ok) {
    const failed = u.access_failed_count + 1;
    await withAudit(self, (trx) =>
      trx
        .updateTable('auth.users')
        .set({ access_failed_count: failed >= MAX_FAILED ? 0 : failed, lockout_end: failed >= MAX_FAILED ? new Date(Date.now() + LOCKOUT_MS) : null })
        .where('id', '=', u.id)
        .execute(),
    );
    throw await fail('Wrong password');
  }

  await withAudit(self, (trx) =>
    trx.updateTable('auth.users').set({ access_failed_count: 0, lockout_end: null, last_login_at: new Date() }).where('id', '=', u.id).execute(),
  );
  const pair = await issueTokens(actor, u.id);
  await logActivity({ ...actor, user: pair.user }, { category: 'SECURITY', eventType: 'LOGIN_SUCCESS' });
  return pair;
}

export async function refresh(actor: Actor, token: string): Promise<TokenPair> {
  const row = await db
    .selectFrom('auth.refresh_tokens')
    .selectAll()
    .where('token_hash', '=', hashToken(token))
    .executeTakeFirst();
  if (!row) throw AppError.unauthorized('Invalid refresh token');

  if (row.revoked_at) {
    // Reuse of a rotated token ⇒ assume theft: revoke the whole family for this user.
    await db.updateTable('auth.refresh_tokens').set({ revoked_at: new Date() }).where('user_id', '=', row.user_id).where('revoked_at', 'is', null).execute();
    await logActivity(actor, { category: 'SECURITY', eventType: 'REFRESH_REUSE', entity: 'user', entityId: row.user_id });
    throw AppError.unauthorized('Refresh token reuse detected; please sign in again');
  }
  if (new Date(row.expires_at) <= new Date()) throw AppError.unauthorized('Refresh token expired');

  return issueTokens(actor, row.user_id, row.id);
}

export async function logout(actor: Actor, token: string | undefined): Promise<void> {
  if (!token) return;
  await db.updateTable('auth.refresh_tokens').set({ revoked_at: new Date() }).where('token_hash', '=', hashToken(token)).where('revoked_at', 'is', null).execute();
  await logActivity(actor, { category: 'SECURITY', eventType: 'LOGOUT' });
}

export async function changePassword(actor: Actor, current: string, next: string): Promise<TokenPair> {
  const userId = actor.user?.id;
  if (!userId) throw AppError.unauthorized();
  if (!PASSWORD_RULE.test(next)) throw AppError.badRequest('Password must be at least 8 characters with a digit and an uppercase letter');

  const u = await db.selectFrom('auth.users').select(['password_hash']).where('id', '=', userId).executeTakeFirstOrThrow();
  if (!(await bcrypt.compare(current, u.password_hash))) throw AppError.badRequest('Current password is incorrect');
  if (await bcrypt.compare(next, u.password_hash)) throw AppError.badRequest('New password must differ from the current one');

  const hash = await bcrypt.hash(next, 10);
  await withAudit(actor, async (trx) => {
    await trx
      .updateTable('auth.users')
      .set({ password_hash: hash, must_change_password: false, updated_by: actor.user!.username, updated_at: new Date() })
      .where('id', '=', userId)
      .execute();
    await trx.updateTable('auth.refresh_tokens').set({ revoked_at: new Date() }).where('user_id', '=', userId).where('revoked_at', 'is', null).execute();
  });
  await logActivity(actor, { category: 'SECURITY', eventType: 'PASSWORD_CHANGED' });
  return issueTokens(actor, userId);
}
