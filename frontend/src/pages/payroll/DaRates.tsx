import { RateHistoryPage } from '@/components/payroll/RateHistoryPage';
import { payrollApi } from '@/services/payroll';

/** DA = RoundRupee((Basic + PP + GP) × DA% / 100) (specs/06 §4). ARDB allows up to 999.99% (TNCU: 100). */
export function DaRatesPage() {
  return (
    <RateHistoryPage
      title="DA Rates"
      subtitle="Dearness Allowance as a % of Basic + Personal Pay + Grade Pay · history cannot be edited"
      label="DA"
      max={999.99}
      example="53"
      queryKey="da-rates"
      api={payrollApi.daRates}
      confirmNote="Arrears for past months are paid through DA Arrears."
    />
  );
}
