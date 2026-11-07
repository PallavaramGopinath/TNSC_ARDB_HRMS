import { AppError } from './errors';
import type { AuthUser } from '../models/auth';

/**
 * TNCU maker-checker guards (IncrementService / LeaveApplicationService / PayrollApprovalService):
 *  - the maker cannot approve their own entry unless Admin
 *  - nobody can reject their own entry
 *  - only the maker (or Admin) can withdraw
 */
export function assertCanApprove(user: AuthUser, makerUsername: string): void {
  if (sameUser(user, makerUsername) && !user.isAdmin) throw AppError.forbidden('The maker cannot approve their own entry');
}

export function assertCanReject(user: AuthUser, makerUsername: string): void {
  if (sameUser(user, makerUsername)) throw AppError.forbidden('The maker cannot reject their own entry');
}

export function assertCanWithdraw(user: AuthUser, makerUsername: string): void {
  if (!sameUser(user, makerUsername) && !user.isAdmin) throw AppError.forbidden('Only the maker can withdraw this entry');
}

const sameUser = (u: AuthUser, maker: string) => u.username.toLowerCase() === maker.toLowerCase();
