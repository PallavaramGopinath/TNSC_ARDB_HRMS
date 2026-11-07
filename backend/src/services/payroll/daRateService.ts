import { createEffectiveRateService } from './effectiveRateService';

/** DA rates — TNCU PayrollDaRateService. */
export const daRates = createEffectiveRateService({ table: 'payroll.payroll_da_rates', column: 'da_percentage', label: 'DA' });
