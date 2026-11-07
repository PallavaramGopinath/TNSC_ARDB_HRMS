import { useQuery } from '@tanstack/react-query';
import { createColumnHelper } from '@tanstack/react-table';
import { Badge } from '@/components/ui/Badge';
import { DataTable } from '@/components/ui/DataTable';
import { PageHeader } from '@/components/ui/PageHeader';
import { payrollApi } from '@/services/payroll';
import type { PayrollComponent } from '@/types/api';

const TYPE = { 1: ['Earnings', 'success'], 2: ['Deductions', 'warning'], 3: ['Loan deductions', 'danger'] } as const;
const col = createColumnHelper<PayrollComponent>();
const columns = [
  col.accessor('display_order', { header: 'Order', cell: (c) => c.getValue() ?? '—' }),
  col.accessor('component_code', { header: 'Code', cell: (c) => <code className="text-xs font-semibold">{c.getValue()}</code> }),
  col.accessor('component_name', { header: 'Name' }),
  col.accessor('component_type', { header: 'Type', cell: (c) => <Badge tone={TYPE[c.getValue()][1]}>{TYPE[c.getValue()][0]}</Badge> }),
  col.accessor('is_da_applicable', { header: 'DA base', cell: (c) => (c.getValue() ? 'Yes' : '—') }),
  col.accessor('is_surrender_leave_applicable', { header: 'SLS base', cell: (c) => (c.getValue() ? 'Yes' : '—') }),
];

/** Read-only for the baseline; CRUD + maker-checker arrives with the payroll masters step. */
export function ComponentsPage() {
  const { data = [], isLoading } = useQuery({ queryKey: ['payroll-components'], queryFn: payrollApi.components.list });
  return (
    <>
      <PageHeader title="Payroll components" subtitle="Pay heads recognised by the calculator (codes from TNCU PayrollComponentCodes)" />
      <DataTable data={data} columns={columns} loading={isLoading} />
    </>
  );
}
