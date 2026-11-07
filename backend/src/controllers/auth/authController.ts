import type { Request, Response } from 'express';
import * as auth from '../../services/auth/authService';
import { createCaptcha } from '../../services/auth/captchaService';
import { env } from '../../config/env';

const actor = (req: Request) => ({ user: req.user, ctx: req.ctx });

export const captcha = (_req: Request, res: Response) => {
  res.json(env.CAPTCHA_ENABLED ? { enabled: true, ...createCaptcha() } : { enabled: false });
};
export const login = async (req: Request, res: Response) => { res.json(await auth.login(actor(req), req.body)); };
export const refresh = async (req: Request, res: Response) => { res.json(await auth.refresh(actor(req), req.body.refreshToken)); };
export const logout = async (req: Request, res: Response) => { await auth.logout(actor(req), req.body?.refreshToken); res.status(204).end(); };
export const me = async (req: Request, res: Response) => { res.json(await auth.buildPrincipal(req.user!.id)); };
export const changePassword = async (req: Request, res: Response) => {
  res.json(await auth.changePassword(actor(req), req.body.currentPassword, req.body.newPassword));
};
