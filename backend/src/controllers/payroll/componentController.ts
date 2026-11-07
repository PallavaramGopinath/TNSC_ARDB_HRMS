import type { Request, Response } from 'express';
import { sql } from 'kysely';
import { db } from '../../config/db';

/** Read-only baseline endpoint; full CRUD + maker-checker lands with the payroll masters step. */
export const list = async (_req: Request, res: Response) => {
  res.json(
    await db.selectFrom('payroll.payroll_components').selectAll().orderBy(sql`display_order asc nulls last`).orderBy('component_code').execute(),
  );
};
