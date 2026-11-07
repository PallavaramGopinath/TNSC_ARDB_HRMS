import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { createColumnHelper } from '@tanstack/react-table';
import { Plus, Search } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { DataTable } from '@/components/ui/DataTable';
import { PageHeader } from '@/components/ui/PageHeader';
import { Pagination } from '@/components/ui/Pagination';
import { useAuth } from '@/hooks/useAuth';
import { formatDate, formatINR } from '@/lib/format';
import { coreApi } from '@/services/core';
import { hrApi } from '@/services/hr';
import type { EmployeeListItem } from '@/types/api';

const col = createColumnHelper<EmployeeListItem>();

/** TNCU /hr/employees grid: code, name, designation, branch, joining, retirement, leaving, basic, status. */
export function EmployeesPage() {
  const { user } = useAuth();
  const canEdit = !!user && (user.isAdmin || user.roles.includes('HR'));
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();

  // Filters live in the URL so Back from a profile returns to the same list.
  const status = (params.get('status') as 'active' | 'left' | 'all') ?? 'active';
  const branchId = params.get('branchId') ?? '';
  const designationId = params.get('designationId') ?? '';
  const page = Number(params.get('page') ?? 1);
  const [q, setQ] = useState(params.get('q') ?? '');

  const set = (patch: Record<string, string>) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) v ? next.set(k, v) : next.delete(k);
    if (!('page' in patch)) next.delete('page');
    setParams(next, { replace: true });
  };

  // Debounce the search box.
  useEffect(() => {
    const t = setTimeout(() => (q !== (params.get('q') ?? '') ? set({ q }) : undefined), 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  const branches = useQuery({ queryKey: ['branches'], queryFn: coreApi.branches, staleTime: 10 * 60_000 });
  const designations = useQuery({ queryKey: ['designations', '', false], queryFn: () => hrApi.designations.list(), staleTime: 60_000 });
  const list = useQuery({
    queryKey: ['employees', { q: params.get('q'), status, branchId, designationId, page }],
    queryFn: () =>
      hrApi.employees.list({
        q: params.get('q') || undefined,
        status,
        branchId: branchId ? Number(branchId) : undefined,
        designationId: designationId ? Number(designationId) : undefined,
        page,
        pageSize: 20,
      }),
    placeholderData: keepPreviousData,
  });

  const columns = useMemo(
    () => [
      col.accessor('employee_code', {
        header: 'Code',
        cell: (c) => <Link to={`/hr/employees/${c.row.original.id}`} className="font-semibold text-brand-700 hover:underline">{c.getValue()}</Link>,
      }),
      col.accessor('employee_name', { header: 'Name' }),
      col.accessor('designation_name', { header: 'Designation' }),
      col.accessor('branch_name', { header: 'Branch' }),
      col.accessor('date_of_joining', { header: 'Joined', cell: (c) => formatDate(c.getValue()) }),
      col.accessor('date_of_retirement', { header: 'Retires', cell: (c) => formatDate(c.getValue()) }),
      col.accessor('date_of_leaving', { header: 'Left', cell: (c) => formatDate(c.getValue()) }),
      col.accessor('basic_salary', { header: () => <span className="block text-right">Basic</span>, cell: (c) => <span className="block text-right tabular-nums">{formatINR(c.getValue())}</span> }),
      col.display({ id: 'status', header: 'Status', cell: (c) => (c.row.original.date_of_leaving ? <Badge>Left</Badge> : <Badge tone="success">Active</Badge>) }),
    ],
    [],
  );

  return (
    <>
      <PageHeader
        title="Employees"
        subtitle="Employee master · active = no date of leaving"
        actions={canEdit && <Button onClick={() => navigate('/hr/employees/new')}><Plus size={16} /> New employee</Button>}
      />
      <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="relative">
          <Search size={14} className="absolute left-3 top-3 text-ink-400" />
          <input className="field-input pl-8" placeholder="Code, name or EPF no." value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search employees" />
        </div>
        <select className="field-input" value={branchId} onChange={(e) => set({ branchId: e.target.value })} aria-label="Branch">
          <option value="">All branches</option>
          {branches.data?.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
        </select>
        <select className="field-input" value={designationId} onChange={(e) => set({ designationId: e.target.value })} aria-label="Designation">
          <option value="">All designations</option>
          {designations.data?.map((d) => <option key={d.id} value={d.id}>{d.designation_name}</option>)}
        </select>
        <select className="field-input" value={status} onChange={(e) => set({ status: e.target.value === 'active' ? '' : e.target.value })} aria-label="Status">
          <option value="active">Active</option>
          <option value="left">Left service</option>
          <option value="all">All</option>
        </select>
      </div>
      <DataTable data={list.data?.items ?? []} columns={columns} loading={list.isLoading} empty="No employees match these filters" />
      {list.data && <Pagination page={page} pageSize={list.data.pageSize} total={list.data.total} onPage={(p) => set({ page: String(p) })} />}
    </>
  );
}
