/** Authenticated principal — built from the JWT (TNCU JwtTokenService claim set). */
export type ModuleGrant = 'M' | 'C' | 'MC';

export const Roles = {
  Admin: 'Admin',
  Maker: 'Maker',
  Checker: 'Checker',
  HR: 'HR',
  Payroll: 'Payroll',
  EPF: 'EPF',
  Employee: 'Employee',
} as const;
export type Role = (typeof Roles)[keyof typeof Roles];

/** Module (menu main) ids — TNCU AppModules, plus EPF Trust reserved for ARDB. */
export const ModuleIds = {
  Home: 10000000,
  Admin: 11000000,
  HR: 12000010,
  Payroll: 12000020,
  EPF: 12000040,
  SelfService: 13000000,
} as const;

export interface AuthUser {
  id: string;
  username: string;
  fullName: string;
  branchId: number;
  branchType: 'HO' | 'BRANCH';
  allBranches: boolean;
  employeeId: number | null;
  isAdmin: boolean;
  mustChangePassword: boolean;
  roles: Role[];
  /** menuId → grant */
  modules: Record<string, ModuleGrant>;
}

export interface RequestContext {
  correlationId: string;
  ip: string | null;
  userAgent: string | null;
}
