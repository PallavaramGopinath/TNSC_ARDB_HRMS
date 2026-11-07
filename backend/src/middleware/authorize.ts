import type { RequestHandler } from 'express';
import { AppError } from '../lib/errors';
import type { Role } from '../models/auth';

/** Any of the listed roles. Admin always passes (TNCU parity). */
export const requireRole =
  (...roles: Role[]): RequestHandler =>
  (req, _res, next) => {
    const u = req.user;
    if (!u) return next(AppError.unauthorized());
    if (u.isAdmin || roles.some((r) => u.roles.includes(r))) return next();
    next(AppError.forbidden());
  };

/** TNCU `HeadOffice` policy: Admin, or a Head-Office user. */
export const requireHeadOffice: RequestHandler = (req, _res, next) => {
  const u = req.user;
  if (!u) return next(AppError.unauthorized());
  if (u.isAdmin || u.branchType === 'HO') return next();
  next(AppError.forbidden('This function is available at Head Office only'));
};

/**
 * Module-level maker/checker gate: `mod:{menuId}` grant must include the requested capability.
 *   'read'    any grant
 *   'maker'   M or MC
 *   'checker' C or MC
 */
export const requireModule =
  (menuId: number, capability: 'read' | 'maker' | 'checker' = 'read'): RequestHandler =>
  (req, _res, next) => {
    const u = req.user;
    if (!u) return next(AppError.unauthorized());
    if (u.isAdmin) return next();
    const grant = u.modules[String(menuId)];
    const ok =
      !!grant &&
      (capability === 'read' ||
        (capability === 'maker' && grant.includes('M')) ||
        (capability === 'checker' && grant.includes('C')));
    if (ok) return next();
    next(AppError.forbidden());
  };
