import type { Request, Response } from 'express';
import * as assignments from '../../services/payroll/componentAssignmentService';

const actor = (req: Request) => ({ user: req.user, ctx: req.ctx });
const id = (req: Request) => Number(req.params.id);
const q = <T>(req: Request) => req.query as unknown as T;

export const list = async (req: Request, res: Response) => { res.json(await assignments.list(q(req))); };
export const get = async (req: Request, res: Response) => { res.json(await assignments.get(id(req))); };
export const create = async (req: Request, res: Response) => { res.status(201).json(await assignments.create(actor(req), req.body)); };
export const update = async (req: Request, res: Response) => { res.json(await assignments.update(actor(req), id(req), req.body)); };
export const revise = async (req: Request, res: Response) => { res.status(201).json(await assignments.revise(actor(req), id(req), req.body)); };
export const deactivate = async (req: Request, res: Response) => { await assignments.deactivate(actor(req), id(req)); res.status(204).end(); };
