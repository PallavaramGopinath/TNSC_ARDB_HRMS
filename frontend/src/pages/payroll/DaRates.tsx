import { RateHistoryPage } from '@/components/payroll/RateHistoryPage';
import { payrollApi } from '@/services/payroll';

/** DA = RoundRupee((Basic + GP + SP) × DA% / 100). ARDB allows up to 999.99% (TNCU: 100). */
export function DaRatesPage() {
  return (
    <RateHistoryPage
      title="DA Rates"
      subtitle="Dearness Allowance as a % of Basic + Grade Pay + Special Pay · history cannot be edited"
      label="DA"
      max={999.99}
      example="53"
      queryKey="da-rates"
      api={payrollApi.daRates}
      confirmNote="Arrears for past months are paid through DA Arrears."
    />
  );
}
