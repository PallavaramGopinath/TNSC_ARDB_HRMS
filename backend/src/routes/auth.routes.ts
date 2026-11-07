import { Router } from 'express';
import * as c from '../controllers/auth/authController';
import { asyncHandler as h } from '../lib/asyncHandler';
import { authenticate } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { ChangePasswordSchema, LoginSchema, RefreshSchema } from '../models/auth.schema';

export const authRoutes = Router()
  .get('/captcha', c.captcha)
  .post('/login', validate(LoginSchema), h(c.login))
  .post('/refresh', validate(RefreshSchema), h(c.refresh))
  .post('/logout', h(c.logout))
  .get('/me', authenticate, h(c.me))
  .post('/change-password', authenticate, validate(ChangePasswordSchema), h(c.changePassword));
