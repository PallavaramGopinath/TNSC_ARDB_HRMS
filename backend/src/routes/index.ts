import { Router } from 'express';
import { mountModules } from '../modules/registry';
import { authRoutes } from './auth.routes';
import { coreRoutes, healthRoutes } from './core.routes';

export function buildApiRouter(): Router {
  const api = Router();
  api.use('/health', healthRoutes);
  api.use('/auth', authRoutes);
  api.use('/core', coreRoutes);
  mountModules(api); // /hr, /payroll, (/epf)
  return api;
}
