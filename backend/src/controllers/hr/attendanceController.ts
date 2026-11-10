import type { Request, Response } from 'express';
import * as svc from '../../services/hr/attendanceService';

const actor = (req: Request) => ({ user: req.user, ctx: req.ctx });

export const month = async (req: Request, res: Response) => { res.json(await svc.getMonth(req.query as never)); };
export const save = async (req: Request, res: Response) => { res.json(await svc.save(actor(req), req.body)); };
export const importRows = async (req: Request, res: Response) => { res.json(await svc.importRows(actor(req), req.body)); };
