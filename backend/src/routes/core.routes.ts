import { Router } from 'express';
import * as c from '../controllers/core/coreController';
import { asyncHandler as h } from '../lib/asyncHandler';
import { authenticate } from '../middleware/auth';

export const healthRoutes = Router().get('/', h(c.health));

/** Shared, signed-in endpoints (menu tree, app context). Admin masters land here next. */
export const coreRoutes = Router()
  .use(authenticate)
  .get('/menu', h(c.menu))
  .get('/context', c.context)
  .get('/branches', h(c.branches))
  .get('/place-categories', h(c.placeCategories));
