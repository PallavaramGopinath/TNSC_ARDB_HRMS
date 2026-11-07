import { useQuery } from '@tanstack/react-query';
import { createColumnHelper } from '@tanstack/react-table';
import { ArrowLeft, Pencil } from 'lucide-react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { DataTable } from '@/components/ui/DataTable';
import { Detail, Grid, Section } from '@/components/ui/Section';
import { useAuth } from '@/hooks/useAuth';
import { MONTHS, formatDate, formatINR, humanize, maskTail } from '@/lib/format';
import { errorMessage } from '@/services/api';
import { hrApi } from '@/services/hr';
import type { ServiceHistoryRow } from '@/types/api';
import { GenderLabel } from '@/types/enums';

const col = createColumnHelper<ServiceHistoryRow>();
const historyColumns = [
  col.accessor('effective_date', { header: 'Effective', cell: (c) => formatDate(c.getValue()) }),
  col.accessor('service_event', { header: 'Event', cell: (c) => <Badge tone="brand">{humanize(c.getValue())}</Badge> }),
  col.accessor('designation_name', { header: 'Designation', cell: (c) => c.getValue() ?? '—' }),
  col.accessor('branch_name', { header: 'Branch', cell: (c) => c.getValue() ?? '—' }),
  col.accessor('basic_pay', { header: 'Basic', cell: (c) => formatINR(c.getValue()) }),
  col.accessor('remarks', { header: 'Remarks', cell: (c) => c.getValue() ?? '—' }),
  col.accessor('created_by', { header: 'By' }),
];

/** Read-only employee profile + service history (TNCU /hr/employees/{id}). */
export function EmployeeProfilePage() {
  const id = Number(useParams().id);
  const navigate = useNavigate();
  const { user } = useAuth();
  const canEdit = !!user && (user.isAdmin || user.roles.includes('HR'));

  const emp = useQuery({ queryKey: ['employee', id], queryFn: () => hrApi.employees.get(id) });
  const history = useQuery({ queryKey: ['employee', id, 'history'], queryFn: () => hrApi.employees.serviceHistory(id) });

  if (emp.isLoading) return <p className="text-ink-400">Loading…</p>;
  if (emp.isError || !emp.data) return <p className="card p-6 text-danger-700">{errorMessage(emp.error)}</p>;
  const e = emp.data;
  const initials = e.employee_name.split(/\s+/).filter(Boolean).map((p) => p[0]).slice(0, 2).join('').toUpperCase();

  return (
    <div className="space-y-5">
      <Link to="/hr/employees" className="inline-flex items-center gap-1 text-sm text-ink-500 hover:text-ink-800"><ArrowLeft size={14} /> Employees</Link>

      <div className="card flex flex-wrap items-center gap-5 p-5">
        <div className="flex h-16 w-16 items-center justify-center rounded-xl bg-brand-100 text-xl font-bold text-brand-700">{initials}</div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-xl font-bold">{e.employee_name}</h1>
            {e.date_of_leaving ? <Badge>Left {formatDate(e.date_of_leaving)}</Badge> : <Badge tone="success">Active</Badge>}
          </div>
          {e.employee_name_tamil && <p className="font-tamil text-sm text-ink-600">{e.employee_name_tamil}</p>}
          <p className="text-sm text-ink-500">
            <span className="font-semibold text-ink-800">{e.employee_code}</span> · {e.designation_name} · {e.branch_name}
          </p>
        </div>
        <div className="text-right">
          <p className="text-xs uppercase tracking-wide text-ink-500">Basic pay</p>
          <p className="text-lg font-bold tabular-nums">{formatINR(e.basic_salary)}</p>
        </div>
        {canEdit && <Button onClick={() => navigate(`/hr/employees/${id}/edit`)}><Pencil size={14} /> Edit</Button>}
      </div>

      <Section title="Personal & contact">
        <Grid cols={4}>
          <Detail label="Gender" value={e.gender ? GenderLabel[e.gender] : null} />
          <Detail label="Date of birth" value={formatDate(e.date_of_birth)} />
          <Detail label="Marital status" value={humanize(e.marital_status)} />
          <Detail label="Blood group" value={e.blood_group} />
          <Detail label="Height / weight" value={`${Number(e.height)} cm / ${Number(e.weight)} kg`} />
          <Detail label="Mobile" value={e.mobile} />
          <Detail label="Email" value={e.email} />
          <Detail label="Address" value={[e.address, e.city, e.district, e.state, e.pincode].filter(Boolean).join(', ')} />
        </Grid>
      </Section>

      <Section title="Identity & bank">
        <Grid cols={4}>
          <Detail label="PAN" value={e.pan_number} />
          <Detail label="Aadhaar" value={maskTail(e.aadhar_number)} />
          <Detail label="EPF number" value={e.epf_number} />
          <Detail label="Bank" value={e.bank_name} />
          <Detail label="Bank branch" value={e.bank_branch} />
          <Detail label="Account number" value={maskTail(e.account_number)} />
          <Detail label="IFSC" value={e.ifsc_code} />
        </Grid>
      </Section>

      <Section title="Service">
        <Grid cols={4}>
          <Detail label="Designation" value={e.designation_name} />
          <Detail label="Grade" value={e.grade} />
          <Detail label="Branch" value={e.branch_name} />
          <Detail label="Employment type" value={humanize(e.employment_type)} />
          <Detail label="Mode of recruitment" value={humanize(e.mode_of_recruitment)} />
          <Detail label="Date of joining" value={formatDate(e.date_of_joining)} />
          <Detail label="Date of retirement" value={formatDate(e.date_of_retirement)} />
          <Detail label="Increment month" value={MONTHS[e.increment_month - 1]} />
          <Detail label="Scale of pay" value={e.scale_of_pay} />
        </Grid>
      </Section>

      <div className="grid gap-5 xl:grid-cols-2">
        <Section title="Appointment & probation">
          <Grid cols={2}>
            <Detail label="Order no. / date" value={e.appointment_order_no ? `${e.appointment_order_no} · ${formatDate(e.appointment_order_date)}` : null} />
            <Detail label="Sponsored by" value={humanize(e.sponsored_by)} />
            <Detail label="Probation" value={e.probation_months != null ? `${e.probation_months} months` : null} />
            <Detail label="Extension" value={e.probation_extension_months ? `${e.probation_extension_months} months (${e.probation_extension_order_no ?? '—'})` : null} />
            <Detail label="Probation test" value={e.probation_test_passed == null ? null : e.probation_test_passed ? `Passed ${formatDate(e.probation_test_passed_on)}` : 'Not passed'} />
            <Detail label="Remarks" value={e.appointment_remarks ?? e.probation_remarks} />
          </Grid>
        </Section>
        <Section title="Confirmation">
          <Grid cols={2}>
            <Detail label="Date of confirmation" value={formatDate(e.date_of_confirmation)} />
            <Detail label="Order no. / date" value={e.confirmation_order_no ? `${e.confirmation_order_no} · ${formatDate(e.confirmation_order_date)}` : null} />
            <Detail label="Confirmed against" value={e.confirmed_against_designation_name} />
            <Detail label="Remarks" value={e.confirmation_remarks ?? e.confirmation_delay_reason} />
          </Grid>
        </Section>
      </div>

      {e.special_category && (
        <Section title="Special appointment">
          <Grid cols={4}>
            <Detail label="Category" value={humanize(e.special_category)} />
            <Detail label="G.O. no. / date" value={e.special_order_no ? `${e.special_order_no} · ${formatDate(e.special_order_date)}` : null} />
            <Detail label="Deceased" value={e.deceased_name ? `${e.deceased_name}${e.deceased_designation ? `, ${e.deceased_designation}` : ''}` : null} />
            <Detail label="Date of death / relation" value={e.deceased_date_of_death ? `${formatDate(e.deceased_date_of_death)} · ${humanize(e.deceased_relationship)}` : null} />
          </Grid>
        </Section>
      )}

      <div>
        <h2 className="mb-2 text-sm font-bold uppercase tracking-wide text-ink-700">Service history</h2>
        <DataTable data={history.data ?? []} columns={historyColumns} loading={history.isLoading} empty="No service events" />
      </div>

      <p className="text-xs text-ink-400">
        Created by {e.created_by} on {new Date(e.created_at).toLocaleString('en-IN')}
        {e.updated_by && ` · last updated by ${e.updated_by} on ${new Date(e.updated_at!).toLocaleString('en-IN')}`}
      </p>
    </div>
  );
}
