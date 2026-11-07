import { randomUUID } from 'node:crypto';
import type { RequestHandler } from 'express';

/** Per-request correlation id (echoed as X-Correlation-Id) + client details for audit. */
export const requestContext: RequestHandler = (req, res, next) => {
  const incoming = req.header('x-correlation-id');
  const correlationId = incoming && /^[\w-]{8,64}$/.test(incoming) ? incoming : randomUUID();
  req.ctx = { correlationId, ip: req.ip ?? null, userAgent: req.header('user-agent') ?? null };
  res.setHeader('X-Correlation-Id', correlationId);
  next();
};
