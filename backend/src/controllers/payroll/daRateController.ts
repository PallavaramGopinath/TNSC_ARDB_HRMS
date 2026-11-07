import type { Request, Response } from 'express';
import type { DaRateInput } from '../../models/payroll/daRate.schema';
import { daRates } from '../../services/payroll/daRateService';

export const list = async (_req: Request, res: Response) => { res.json(await daRates.list()); };
export const active = async (_req: Request, res: Response) => { res.json((await daRates.active()) ?? null); };
export const create = async (req: Request, res: Response) => {
  const b = req.body as DaRateInput;
  res.status(201).json(await daRates.addNewActiveRate({ user: req.user, ctx: req.ctx }, { effectiveFrom: b.effectiveFrom, percentage: b.daPercentage }));
};
