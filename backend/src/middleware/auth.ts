import type { RequestHandler } from 'express';
import { AppError } from '../lib/errors';
import { verifyAccessToken } from '../services/auth/tokenService';

/** Requires a valid bearer token; populates req.user. */
export const authenticate: RequestHandler = (req, _res, next) => {
  const header = req.header('authorization');
  if (!header?.startsWith('Bearer ')) return next(AppError.unauthorized());
  try {
    req.user = verifyAccessToken(header.slice(7));
    next();
  } catch {
    next(AppError.unauthorized('Session expired or invalid token'));
  }
};

/** Blocks everything except change-password while the user must change their password. */
export const requirePasswordChanged: RequestHandler = (req, _res, next) => {
  if (req.user?.mustChangePassword) return next(AppError.forbidden('Password change required'));
  next();
};
