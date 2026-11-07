import type { ErrorRequestHandler, RequestHandler } from 'express';
import { ZodError } from 'zod';
import { logger } from '../config/logger';
import { AppError } from '../lib/errors';

export const notFoundHandler: RequestHandler = (req, res) => {
  res.status(404).json({ error: { code: 'NOT_FOUND', message: `No route for ${req.method} ${req.path}` } });
};

/** Maps domain, validation and PostgreSQL constraint errors to a consistent JSON shape. */
export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  const correlationId = req.ctx?.correlationId;

  if (err instanceof AppError) {
    return res.status(err.status).json({ error: { code: err.code, message: err.message, details: err.details, correlationId } });
  }
  if (err instanceof ZodError) {
    return res.status(400).json({
      error: { code: 'VALIDATION', message: 'Validation failed', details: err.flatten().fieldErrors, correlationId },
    });
  }
  // node-postgres errors carry SQLSTATE in .code
  const pg = err as { code?: string; constraint?: string; detail?: string };
  const map: Record<string, [number, string]> = {
    '23505': [409, 'A record with the same unique value already exists'],
    '23503': [409, 'The record is referenced by, or refers to, another record'],
    '23514': [400, 'A business rule (check constraint) was violated'],
    '23502': [400, 'A required value is missing'],
  };
  if (pg.code && map[pg.code]) {
    const [status, message] = map[pg.code]!;
    return res.status(status).json({ error: { code: `DB_${pg.code}`, message, details: { constraint: pg.constraint }, correlationId } });
  }

  logger.error({ err, correlationId }, 'Unhandled error');
  res.status(500).json({ error: { code: 'INTERNAL', message: 'Unexpected server error', correlationId } });
};
