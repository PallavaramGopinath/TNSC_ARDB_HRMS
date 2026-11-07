import { createEffectiveRateService } from './effectiveRateService';

/** PF deduction rates — TNCU PayrollPfDeductionRateService. Employer PF mirrors employee PF; no wage ceiling. */
export const pfRates = createEffectiveRateService({ table: 'payroll.payroll_pf_deduction_rates', column: 'pf_deduction_percentage', label: 'PF' });
