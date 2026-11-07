import type { Request, Response } from 'express';
import { checkDb } from '../../config/db';
import { businessDate } from '../../lib/dates';
import { enabledModules } from '../../modules/registry';
import { getMenuTree } from '../../services/core/menuService';
import { listBranches, listPlaceCategories } from '../../services/core/lookupService';

export const health = async (_req: Request, res: Response) => {
  const dbOk = await checkDb();
  res.status(dbOk ? 200 : 503).json({
    status: dbOk ? 'ok' : 'degraded',
    database: dbOk ? 'up' : 'down',
    businessDate: businessDate(),
    modules: enabledModules().map((m) => m.key),
    time: new Date().toISOString(),
  });
};

export const menu = async (req: Request, res: Response) => { res.json(await getMenuTree(req.user!)); };

export const context = (req: Request, res: Response) => {
  res.json({ businessDate: businessDate(), user: req.user, modules: enabledModules().map((m) => ({ key: m.key, title: m.title, menuId: m.menuId })) });
};

export const branches = async (_req: Request, res: Response) => { res.json(await listBranches()); };

export const placeCategories = async (_req: Request, res: Response) => { res.json(await listPlaceCategories()); };
