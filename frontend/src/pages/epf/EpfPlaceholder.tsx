import { PiggyBank } from 'lucide-react';
import { PageHeader } from '@/components/ui/PageHeader';

/** EPF Trust — reserved. Enabled when the module spec is implemented (backend MODULES_ENABLED + menu row). */
export function EpfPlaceholderPage() {
  return (
    <>
      <PageHeader title="EPF Trust" subtitle="Reserved module" />
      <div className="card flex flex-col items-center gap-2 p-12 text-center">
        <PiggyBank className="text-brand-500" size={32} />
        <p className="font-semibold">EPF Trust ledger, interest calculator and statements</p>
        <p className="max-w-md text-sm text-ink-500">Payroll already emits monthly PF contribution events for this module to consume.</p>
      </div>
    </>
  );
}
