import type { Request, Response } from 'express';
import * as attendance from '../../services/payroll/periodAttendanceService';
import * as deductions from '../../services/payroll/periodDeductionService';
import * as manual from '../../services/payroll/manualDeductionService';
import * as periods from '../../services/payroll/periodService';
import * as svc from '../../services/payroll/preparationService';
import { readiness as readinessOf } from '../../services/payroll/readinessService';

const actor = (req: Request) => ({ user: req.user, ctx: req.ctx });
const id = (req: Request) => Number(req.params.id);
const periodId = (req: Request) => Number(req.params.periodId);
const employeeId = (req: Request) => Number(req.params.employeeId);

export const resolveActive = async (req: Request, res: Response) => { res.json(await periods.resolveActive(actor(req))); };
export const prepare = async (req: Request, res: Response) => { res.json(await svc.prepare(actor(req), req.body)); };
export const approve = async (req: Request, res: Response) => { res.json(await svc.approve(actor(req), req.body.periodId)); };
export const reject = async (req: Request, res: Response) => { res.json(await svc.reject(actor(req), id(req), req.body.reason)); };
export const reverse = async (req: Request, res: Response) => { res.json(await svc.reverse(actor(req), id(req), req.body.reason)); };
export const withhold = async (req: Request, res: Response) => { res.json(await svc.withhold(actor(req), id(req), req.body)); };
export const grid = async (req: Request, res: Response) => { res.json(await svc.grid(periodId(req))); };
export const bill = async (req: Request, res: Response) => { res.json(await svc.bill(id(req))); };
export const readiness = async (req: Request, res: Response) => { res.json(await readinessOf(periodId(req))); };

export const attendanceGet = async (req: Request, res: Response) => { res.json(await attendance.get(periodId(req))); };
export const attendanceSave = async (req: Request, res: Response) => { res.json(await attendance.save(actor(req), periodId(req), req.body)); };
export const attendanceImport = async (req: Request, res: Response) => { res.json(await attendance.importRows(actor(req), periodId(req), req.body)); };

export const deductionsGet = async (req: Request, res: Response) => { res.json(await deductions.get(periodId(req))); };
export const deductionsSave = async (req: Request, res: Response) => { res.json(await deductions.save(actor(req), periodId(req), req.body)); };
export const deductionsImport = async (req: Request, res: Response) => { res.json(await deductions.importRows(actor(req), periodId(req), req.body)); };

export const manualGet = async (req: Request, res: Response) => { res.json(await manual.get(periodId(req), employeeId(req))); };
export const manualSave = async (req: Request, res: Response) => { res.json(await manual.saveAndPrepare(actor(req), periodId(req), employeeId(req), req.body)); };
