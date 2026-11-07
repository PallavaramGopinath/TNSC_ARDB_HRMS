import { db } from '../../config/db';
import type { Actor } from '../../lib/dbContext';
import type { Tx } from '../../lib/dbContext';

export interface ActivityEntry {
  category: 'DATA_CHANGE' | 'SECURITY' | 'APPROVAL' | 'ACCESS';
  eventType: string; // LOGIN_SUCCESS | LOGIN_FAILED | SUBMITTED | APPROVED | REJECTED | WITHDRAWN | REPORT_EXPORTED …
  module?: string;
  entity?: string;
  entityId?: string | number;
  summary?: string;
  details?: unknown;
  userName?: string; // for anonymous events (failed login)
}

/** Explicit SECURITY / APPROVAL / ACCESS events. Row-level DATA_CHANGE is captured by the DB trigger. */
export async function logActivity(actor: Actor, e: ActivityEntry, trx?: Tx): Promise<void> {
  await (trx ?? db)
    .insertInto('audit.activity_logs')
    .values({
      category: e.category,
      event_type: e.eventType,
      module: e.module ?? null,
      entity: e.entity ?? null,
      entity_id: e.entityId != null ? String(e.entityId) : null,
      summary: e.summary ?? null,
      details: e.details != null ? JSON.stringify(e.details) : null,
      user_id: actor.user?.id ?? null,
      user_name: actor.user?.username ?? e.userName ?? 'anonymous',
      branch_id: actor.user?.branchId ?? null,
      ip_address: actor.ctx?.ip ?? null,
      user_agent: actor.ctx?.userAgent ?? null,
      http_method: null,
      route: null,
      correlation_id: actor.ctx?.correlationId ?? null,
    })
    .execute();
}
