import { createHash, randomBytes } from 'node:crypto';
import jwt from 'jsonwebtoken';
import { env } from '../../config/env';
import type { AuthUser } from '../../models/auth';

interface AccessClaims {
  sub: string;
  name: string;
  fullName: string;
  branchId: number;
  branchType: 'HO' | 'BRANCH';
  allBranches: boolean;
  employeeId: number | null;
  isAdmin: boolean;
  mustChangePassword: boolean;
  roles: AuthUser['roles'];
  mods: AuthUser['modules'];
}

export function signAccessToken(u: AuthUser): { token: string; expiresAt: Date } {
  const claims: AccessClaims = {
    sub: u.id,
    name: u.username,
    fullName: u.fullName,
    branchId: u.branchId,
    branchType: u.branchType,
    allBranches: u.allBranches,
    employeeId: u.employeeId,
    isAdmin: u.isAdmin,
    mustChangePassword: u.mustChangePassword,
    roles: u.roles,
    mods: u.modules,
  };
  const token = jwt.sign(claims, env.JWT_SECRET, {
    algorithm: 'HS256',
    issuer: env.JWT_ISSUER,
    audience: env.JWT_AUDIENCE,
    expiresIn: env.JWT_ACCESS_MINUTES * 60,
  });
  return { token, expiresAt: new Date(Date.now() + env.JWT_ACCESS_MINUTES * 60_000) };
}

export function verifyAccessToken(token: string): AuthUser {
  const c = jwt.verify(token, env.JWT_SECRET, {
    algorithms: ['HS256'],
    issuer: env.JWT_ISSUER,
    audience: env.JWT_AUDIENCE,
  }) as AccessClaims;
  return {
    id: c.sub,
    username: c.name,
    fullName: c.fullName,
    branchId: c.branchId,
    branchType: c.branchType,
    allBranches: c.allBranches,
    employeeId: c.employeeId,
    isAdmin: c.isAdmin,
    mustChangePassword: c.mustChangePassword,
    roles: c.roles,
    modules: c.mods,
  };
}

/** Opaque refresh token (64 random bytes, base64url). Only its SHA-256 is stored. */
export function newRefreshToken(): { token: string; hash: string; expiresAt: Date } {
  const token = randomBytes(64).toString('base64url');
  return { token, hash: hashToken(token), expiresAt: new Date(Date.now() + env.REFRESH_TOKEN_DAYS * 86_400_000) };
}

export const hashToken = (t: string) => createHash('sha256').update(t).digest('hex');
