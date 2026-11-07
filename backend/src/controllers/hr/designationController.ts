import type { Request, Response } from 'express';
import * as svc from '../../services/hr/designationService';

const actor = (req: Request) => ({ user: req.user, ctx: req.ctx });
const id = (req: Request) => Number(req.params.id);

export const list = async (req: Request, res: Response) => { res.json(await svc.list(req.query as never)); };
export const get = async (req: Request, res: Response) => { res.json(await svc.get(id(req))); };
export const create = async (req: Request, res: Response) => { res.status(201).json(await svc.create(actor(req), req.body)); };
export const update = async (req: Request, res: Response) => { res.json(await svc.update(actor(req), id(req), req.body)); };
export const remove = async (req: Request, res: Response) => { await svc.deactivate(actor(req), id(req)); res.status(204).end(); };
