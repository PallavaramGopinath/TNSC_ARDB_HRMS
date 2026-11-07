import type { Request, Response } from 'express';
import type { PfRateInput } from '../../models/payroll/pfRate.schema';
import { pfRates } from '../../services/payroll/pfRateService';

export const list = async (_req: Request, res: Response) => { res.json(await pfRates.list()); };
export const active = async (_req: Request, res: Response) => { res.json((await pfRates.active()) ?? null); };
export const create = async (req: Request, res: Response) => {
  const b = req.body as PfRateInput;
  res.status(201).json(await pfRates.addNewActiveRate({ user: req.user, ctx: req.ctx }, { effectiveFrom: b.effectiveFrom, percentage: b.pfPercentage }));
};
