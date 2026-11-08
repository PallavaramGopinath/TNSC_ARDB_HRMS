import type { Request, Response } from 'express';
import { businessDate } from '../../lib/dates';
import * as basis from '../../services/payroll/hraCcaBasisService';
import * as resolver from '../../services/payroll/hraCcaRateResolver';
import * as rates from '../../services/payroll/hraCcaRateService';

const actor = (req: Request) => ({ user: req.user, ctx: req.ctx });
const id = (req: Request) => Number(req.params.id);
const q = <T>(req: Request) => req.query as unknown as T;

// Calculation basis — spec §6
export const basisStatus = async (_req: Request, res: Response) => { res.json(await basis.status()); };
export const basisChange = async (req: Request, res: Response) => { res.json(await basis.change(actor(req), req.body.basis)); };
export const basisCoverage = async (req: Request, res: Response) => {
  const { basis: b, asOn } = q<{ basis: 'PLACE' | 'DESIGNATION'; asOn?: string }>(req);
  res.json(await basis.coverage(b, asOn ?? (await basis.nextPeriodStart())));
};

// Rates
export const list = async (req: Request, res: Response) => { res.json(await rates.list(q(req))); };
export const get = async (req: Request, res: Response) => { res.json(await rates.get(id(req))); };
export const create = async (req: Request, res: Response) => { res.status(201).json(await rates.create(actor(req), req.body)); };
export const update = async (req: Request, res: Response) => { res.json(await rates.update(actor(req), id(req), req.body)); };
export const revise = async (req: Request, res: Response) => { res.status(201).json(await rates.revise(actor(req), id(req), req.body)); };
export const bulkRevise = async (req: Request, res: Response) => { res.status(201).json(await rates.bulkRevise(actor(req), req.body)); };
export const deactivate = async (req: Request, res: Response) => { await rates.deactivate(actor(req), id(req)); res.status(204).end(); };
export const missing = async (req: Request, res: Response) => { res.json(await rates.missing(q<{ asOn?: string }>(req).asOn)); };
export const affected = async (req: Request, res: Response) => { res.json(await rates.affectedEmployees(q(req))); };
export const resolve = async (req: Request, res: Response) => {
  const { employeeId, asOn } = q<{ employeeId: number; asOn?: string }>(req);
  res.json(await resolver.resolve(Number(employeeId), asOn ?? businessDate()));
};
