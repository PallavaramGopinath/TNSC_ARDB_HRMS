import type { Request, Response } from 'express';
import * as amounts from '../../services/payroll/hraAmountService';

const actor = (req: Request) => ({ user: req.user, ctx: req.ctx });
const id = (req: Request) => Number(req.params.id);
const q = <T>(req: Request) => req.query as unknown as T;

export const list = async (req: Request, res: Response) => { res.json(await amounts.list(q(req))); };
export const get = async (req: Request, res: Response) => { res.json(await amounts.get(id(req))); };
export const missing = async (req: Request, res: Response) => { res.json(await amounts.missing(q<{ asOn?: string }>(req).asOn)); };
export const create = async (req: Request, res: Response) => { res.status(201).json(await amounts.create(actor(req), req.body)); };
export const update = async (req: Request, res: Response) => { res.json(await amounts.update(actor(req), id(req), req.body)); };
export const revise = async (req: Request, res: Response) => { res.status(201).json(await amounts.revise(actor(req), id(req), req.body)); };
export const deactivate = async (req: Request, res: Response) => { await amounts.deactivate(actor(req), id(req)); res.status(204).end(); };
