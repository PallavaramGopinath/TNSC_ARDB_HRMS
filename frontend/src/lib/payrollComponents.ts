import type { PayrollComponent } from '@/types/api';

/** Name and badge colour of each component type. */
export const COMPONENT_TYPE = { 1: ['Earnings', 'success'], 2: ['Deductions', 'warning'], 3: ['Loan deductions', 'danger'] } as const;

/** 'BASIC — Basic Pay (Earnings)' */
export const componentLabel = (c: Pick<PayrollComponent, 'component_code' | 'component_name' | 'component_type'>) =>
  `${c.component_code} — ${c.component_name} (${COMPONENT_TYPE[c.component_type][0]})`;

/**
 * Components payroll works out itself, or pays through their own payroll types. They are not assigned to
 * employees one by one (spec 07 §4.6).
 */
const NOT_ASSIGNABLE = new Set(['DA', 'HRA', 'CCA', 'MA', 'EMPLOYER_PF', 'BONUS', 'EX_GRATIA', 'SLS', 'GRATUITY']);
export const isAssignable = (code: string) => !NOT_ASSIGNABLE.has(code.trim().toUpperCase());
