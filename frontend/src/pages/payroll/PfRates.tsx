import { RateHistoryPage } from '@/components/payroll/RateHistoryPage';
import { payrollApi } from '@/services/payroll';

/** PF = RoundRupee((Basic + GP + SP + DA earned) × PF% / 100); employer PF matches it; no wage ceiling. */
export function PfRatesPage() {
  return (
    <RateHistoryPage
      title="PF Rates"
      subtitle="Employee PF as a % of Basic + GP + SP + DA earned · employer PF matches it · no wage ceiling"
      label="PF"
      max={100}
      example="12"
      queryKey="pf-rates"
      api={payrollApi.pfRates}
      confirmNote="Payroll prepared for months before the new date keeps the old rate."
    />
  );
}
