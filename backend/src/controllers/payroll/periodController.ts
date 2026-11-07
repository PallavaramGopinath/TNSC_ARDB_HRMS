import type { Request, Response } from 'express';
import * as svc from '../../services/payroll/periodService';

const actor = (req: Request) => ({ user: req.user, ctx: req.ctx });
const id = (req: Request) => Number(req.params.id);

export const list = async (req: Request, res: Response) => { res.json(await svc.list(req.query as never)); };
export const get = async (req: Request, res: Response) => { res.json(await svc.get(id(req))); };
export const create = async (req: Request, res: Response) => { res.status(201).json(await svc.create(actor(req), req.body)); };
export const update = async (req: Request, res: Response) => { res.json(await svc.update(actor(req), id(req), req.body)); };
export const remove = async (req: Request, res: Response) => { await svc.remove(actor(req), id(req)); res.status(204).end(); };
export const workingDays = async (req: Request, res: Response) => { res.json(await svc.setWorkingDays(actor(req), id(req), req.body.workingDays)); };
export const lockAndRoll = async (req: Request, res: Response) => { res.json(await svc.lockAndOpenNext(actor(req), id(req))); };
