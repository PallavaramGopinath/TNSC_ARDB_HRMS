import { sql, type Transaction } from 'kysely';
import { db } from '../config/db';
import type { AuthUser, RequestContext } from '../models/auth';
import type { Database } from '../models/db.types';

export type Tx = Transaction<Database>;

export interface Actor {
  user?: AuthUser;
  ctx?: RequestContext;
}

/** Display string stored in created_by / approved_by columns (TNCU stores the user name). */
export const actorName = (a: Actor): string => a.user?.username ?? 'system';

/**
 * Run `fn` in a transaction with the audit context set (SET LOCAL app.*), so the
 * audit.log_row_change() trigger can attribute every row change. All writes go through this.
 */
export async function withAudit<T>(actor: Actor, fn: (trx: Tx) => Promise<T>): Promise<T> {
  return db.transaction().execute(async (trx) => {
    await sql`select set_config('app.user_id', ${actor.user?.id ?? 'system'}, true),
                     set_config('app.user_name', ${actorName(actor)}, true),
                     set_config('app.correlation_id', ${actor.ctx?.correlationId ?? ''}, true)`.execute(trx);
    return fn(trx);
  });
}
