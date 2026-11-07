import type { RequestHandler } from 'express';
import type { ZodTypeAny, z } from 'zod';

type Part = 'body' | 'query' | 'params';

/** Validates and replaces req[part] with the parsed (coerced, stripped) value. Errors → errorHandler. */
export const validate =
  <S extends ZodTypeAny>(schema: S, part: Part = 'body'): RequestHandler =>
  (req, _res, next) => {
    const result = schema.safeParse(req[part]);
    if (!result.success) return next(result.error);
    if (part === 'query') {
      // req.query is a getter in Express 5; assign keys for forward-compat.
      Object.assign(req.query, result.data as z.infer<S>);
    } else {
      (req as unknown as Record<Part, unknown>)[part] = result.data;
    }
    next();
  };
