import type { AuthUser, RequestContext } from '../models/auth';

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
      ctx: RequestContext;
    }
  }
}
export {};
