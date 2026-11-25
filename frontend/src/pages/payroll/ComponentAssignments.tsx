import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createColumnHelper } from '@tanstack/react-table';
import { Ban, Eye, Pencil, Plus, RefreshCw } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { DataTable } from '@/components/ui/DataTable';
import { Field } from '@/components/ui/Field';
import { Modal } from '@/components/ui/Modal';
import { PageHeader } from '@/components/ui/PageHeader';
import { Pagination } from '@/components/ui/Pagination';
import { Select, type Option } from '@/components/ui/Select';
import { useAuth } from '@/hooks/useAuth';
import { formatDate, formatINR, humanize } from '@/lib/format';
import { errorMessage, fieldErrors } from '@/services/api';
import { hrApi } from '@/services/hr';
import { payrollApi, type AssignmentInput } from '@/services/payroll';
import type { AssignedType, ComponentAssignment, EmployeeListItem, HraCcaStatus } from '@/types/api';

/**
 * Payroll › Masters › Component Assignments (docs §3.1): what one employee is paid, or has deducted, under a
 * component — a fixed amount or a percentage, with effective dates. Personal Pay and Grade Pay are entered here.
 */
const col = createColumnHelper<ComponentAssignment>();
const PAGE_SIZE = 50;
const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
const statusTone: Record<HraCcaStatus, 'success' | 'brand' | 'neutral' | 'danger'> = { CURRENT: 'success', FUTURE: 'brand', EXPIRED: 'neutral', INACTIVE: 'danger' };
const statusOptions: Option[] = [...['CURRENT', 'FUTURE', 'EXPIRED', 'INACTIVE'].map((v) => ({ value: v, label: humanize(v) })), { value: 'ALL', label: 'All' }];
const typeOptions: Option[] = [{ value: 'FIXED', label: 'Fixed amount' }, { value: 'PERCENTAGE', label: 'Percentage' }];

/** '₹500.00' or '7.5%', with the limits of a percentage if it has any. */
const limits = (r: ComponentAssignment) =>
  [Number(r.minimum_amount) > 0 && `min ${formatINR(r.minimum_amount)}`, Number(r.maximum_amount) > 0 && `max ${formatINR(r.maximum_amount)}`].filter(Boolean).join(', ');
const value = (r: ComponentAssignment) => (r.assigned_type === 'FIXED' ? formatINR(r.assigned_amount) : `${Number(r.percentage)}%`);
const startText = (d: string | null) => (d ? `from ${formatDate(d)}` : 'with no start date');

type FormMode = 'add' | 'edit' | 'revise' | 'view';
interface FormState { mode: FormMode; row?: ComponentAssignment }

export function ComponentAssignmentsPage() {
  const qc = useQueryClient();
  const { user } = useAuth();
  const canEdit = !!user && (user.isAdmin || user.roles.includes('Payroll'));
  const [status, setStatus] = useState('CURRENT');
  const [componentId, setComponentId] = useState('');
  const [asOn, setAsOn] = useState(today());
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [form, setForm] = useState<FormState | null>(null);
  const [deactivating, setDeactivating] = useState<ComponentAssignment | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const components = useQuery({ queryKey: ['payroll-components', true], queryFn: () => payrollApi.components.list({ includeInactive: true }) });
  const params = { status, componentId: componentId || undefined, asOn: asOn || undefined, search: search || undefined, page, size: PAGE_SIZE };
  const listQ = useQuery({ queryKey: ['component-assignments', params], queryFn: () => payrollApi.assignments.list(params), placeholderData: keepPreviousData });

  const componentOptions = (all: boolean): Option[] =>
    (components.data ?? []).filter((c) => all || c.is_active).map((c) => ({ value: c.id, label: `${c.component_code} — ${c.component_name}` }));
  const filter = (set: (v: string) => void) => (v: string) => { set(v); setPage(1); };

  const refresh = (msg?: string) => {
    setNotice(msg ?? null);
    for (const key of ['component-assignments', 'component-assignment', 'allowance-preview', 'payroll-components']) void qc.invalidateQueries({ queryKey: [key] });
  };

  const columns = useMemo(
    () => [
      col.accessor('employee_name', {
        header: 'Employee',
        cell: (c) => (
          <span>
            <span className="block font-medium">{c.getValue()}</span>
            <span className="block text-xs text-ink-500">{c.row.original.employee_code} · {c.row.original.designation_name}</span>
          </span>
        ),
      }),
      col.accessor('component_code', {
        header: 'Component',
        cell: (c) => (
          <span>
            <code className="block text-xs font-semibold">{c.getValue()}</code>
            <span className="block text-xs text-ink-500">{c.row.original.component_name}</span>
          </span>
        ),
      }),
      col.accessor((r) => Number(r.assigned_type === 'FIXED' ? r.assigned_amount : r.percentage), {
        id: 'value',
        header: () => <span className="block text-right">Amount or %</span>,
        cell: (c) => (
          <span className="block text-right tabular-nums">
            <span className="block font-semibold">{value(c.row.original)}</span>
            {limits(c.row.original) && <span className="block text-xs text-ink-500">{limits(c.row.original)}</span>}
          </span>
        ),
      }),
      col.accessor('effective_from', { header: 'Eff. from', cell: (c) => formatDate(c.getValue()) }),
      col.accessor('effective_to', { header: 'Eff. to', cell: (c) => formatDate(c.getValue()) }),
      col.accessor('status', { header: 'Status', cell: (c) => <Badge tone={statusTone[c.getValue()]}>{humanize(c.getValue())}</Badge> }),
      col.display({
        id: 'actions',
        header: '',
        cell: (c) => {
          const r = c.row.original;
          const what = `${r.component_code} of ${r.employee_name}`;
          const editable = canEdit && (r.status === 'CURRENT' || r.status === 'FUTURE');
          return (
            <div className="flex justify-end gap-1">
              {editable ? (
                <>
                  <Button variant="ghost" title="Edit" aria-label={`Edit ${what}`} onClick={() => setForm({ mode: 'edit', row: r })}><Pencil size={14} /></Button>
                  <Button variant="ghost" title="Revise" aria-label={`Revise ${what}`} onClick={() => setForm({ mode: 'revise', row: r })}><RefreshCw size={14} /></Button>
                  <Button variant="ghost" title="Deactivate" aria-label={`Deactivate ${what}`} onClick={() => setDeactivating(r)}><Ban size={14} /></Button>
                </>
              ) : (
                <Button variant="ghost" title="View" aria-label={`View ${what}`} onClick={() => setForm({ mode: 'view', row: r })}><Eye size={14} /></Button>
              )}
            </div>
          );
        },
      }),
    ],
    [canEdit],
  );

  return (
    <>
      <PageHeader
        title="Component Assignments"
        subtitle="Amounts and percentages set per employee, such as Personal Pay and Grade Pay"
        actions={canEdit ? <Button onClick={() => setForm({ mode: 'add' })}><Plus size={16} /> Add assignment</Button> : undefined}
      />

      <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Field id="f-search" label="Search" placeholder="Employee name or code" value={search} onChange={(e) => filter(setSearch)(e.target.value)} />
        <Select id="f-component" label="Component" placeholder="Any" options={componentOptions(true)} value={componentId} onChange={(e) => filter(setComponentId)(e.target.value)} />
        <Select id="f-status" label="Status" placeholder="Any" options={statusOptions} value={status} onChange={(e) => filter(setStatus)(e.target.value || 'ALL')} />
        <Field id="f-as-on" label="As on" type="date" value={asOn} onChange={(e) => filter(setAsOn)(e.target.value)} />
      </div>

      {notice && (
        <p role="status" className="mb-3 flex items-start justify-between gap-3 rounded-lg bg-warning-50 px-3 py-2 text-sm text-warning-700">
          <span>{notice}</span>
          <button type="button" className="text-xs font-semibold" onClick={() => setNotice(null)}>Dismiss</button>
        </p>
      )}
      {listQ.isError && <p role="alert" className="mb-3 rounded-lg bg-danger-50 px-3 py-2 text-sm text-danger-700">{errorMessage(listQ.error)}</p>}

      <DataTable data={listQ.data?.items ?? []} columns={columns} loading={listQ.isLoading} empty="No assignments match these filters" />
      {!!listQ.data?.total && <Pagination page={page} pageSize={PAGE_SIZE} total={listQ.data.total} onPage={setPage} />}

      {form && (
        <AssignmentForm
          state={form}
          components={componentOptions(false)}
          onClose={() => setForm(null)}
          onSaved={(warnings) => { setForm(null); refresh(warnings.length ? warnings.join(' ') : undefined); }}
        />
      )}
      {deactivating && <DeactivateDialog row={deactivating} onClose={() => setDeactivating(null)} onDone={() => { setDeactivating(null); refresh(); }} />}
    </>
  );
}

interface FormValues {
  employeeId: string; // set by the picker; here so that errors can be attached to it
  componentId: string;
  assignedType: string;
  assignedAmount: string;
  percentage: string;
  minimumAmount: string;
  maximumAmount: string;
  effectiveFrom: string;
  effectiveTo: string;
}

const num = (v: string | undefined) => (v && Number(v) !== 0 ? String(Number(v)) : '');

function AssignmentForm({ state, components, onClose, onSaved }: {
  state: FormState;
  components: Option[];
  onClose: () => void;
  onSaved: (warnings: string[]) => void;
}) {
  const { mode, row } = state;
  const [employee, setEmployee] = useState<EmployeeListItem | null>(null);
  const detail = useQuery({ queryKey: ['component-assignment', row?.id], queryFn: () => payrollApi.assignments.get(row!.id), enabled: !!row, staleTime: 0, gcTime: 0 });
  const viewOnly = mode === 'view';
  const locked = mode === 'edit' && !!detail.data?.usedInFinalisedPayroll;

  const { register, handleSubmit, setError, clearErrors, watch, formState } = useForm<FormValues>({
    defaultValues: {
      employeeId: '',
      componentId: '',
      assignedType: row?.assigned_type ?? 'FIXED',
      assignedAmount: row?.assigned_type === 'FIXED' ? String(Number(row.assigned_amount)) : '',
      percentage: num(row?.percentage),
      minimumAmount: num(row?.minimum_amount),
      maximumAmount: num(row?.maximum_amount),
      effectiveFrom: mode === 'revise' ? '' : row?.effective_from ?? '',
      effectiveTo: mode === 'revise' ? '' : row?.effective_to ?? '',
    },
  });
  const err = (k: keyof FormValues) => formState.errors[k]?.message;
  const type = watch('assignedType');
  const startRequired = mode !== 'edit' || row?.effective_from !== null;

  const save = useMutation({
    mutationFn: ({ employeeId: _e, componentId, effectiveTo, ...v }: FormValues) => {
      const terms: AssignmentInput = { ...v, assignedType: v.assignedType as AssignedType };
      if (mode === 'revise') return payrollApi.assignments.revise(row!.id, terms);
      const body = { ...terms, effectiveTo };
      return mode === 'add' ? payrollApi.assignments.create({ ...body, employeeId: employee!.id, componentId }) : payrollApi.assignments.update(row!.id, body);
    },
    onSuccess: (r) => onSaved(r.warnings ?? []),
    onError: (e) => {
      const fe = fieldErrors(e);
      if (fe) for (const [f, m] of Object.entries(fe)) setError(f as keyof FormValues, { message: m[0] });
    },
  });

  const submit = handleSubmit((v) => {
    if (mode === 'add' && !employee) { setError('employeeId', { message: 'Select an employee.' }); return; }
    save.mutate(v);
  });

  const title = { add: 'Add assignment', edit: 'Edit assignment', revise: 'Revise assignment', view: 'Assignment' }[mode];
  return (
    <Modal open title={title} onClose={onClose}>
      <form noValidate className="space-y-4" onSubmit={(e) => { clearErrors(); void submit(e); }}>
        {mode === 'add' ? (
          <>
            <EmployeePicker value={employee} onChange={(e) => { setEmployee(e); clearErrors('employeeId'); }} error={err('employeeId')} />
            <Select label="Component *" placeholder="Select component" options={components} {...register('componentId', { required: 'Select a component.' })} error={err('componentId')} />
          </>
        ) : (
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
            <dt className="text-ink-500">Employee</dt><dd className="font-semibold">{row?.employee_name} ({row?.employee_code})</dd>
            <dt className="text-ink-500">Component</dt><dd className="font-semibold">{row?.component_code} — {row?.component_name}</dd>
          </dl>
        )}
        {mode === 'revise' && row && (
          <p className="rounded-lg bg-brand-25 px-3 py-2 text-sm text-ink-700">
            Current: {value(row)}{limits(row) && ` (${limits(row)})`}, {startText(row.effective_from)}. It will close the day before the new effective date.
          </p>
        )}
        {locked && (
          <p className="rounded-lg bg-warning-50 px-3 py-2 text-sm text-warning-700">
            This assignment has been used in a finalised payroll. Only the end date can be changed; use Revise to change the amount.
          </p>
        )}
        <fieldset disabled={viewOnly || locked} className="grid grid-cols-2 gap-3">
          <Select label="Type *" placeholder="Select type" options={typeOptions} {...register('assignedType', { required: 'Select fixed amount or percentage' })} error={err('assignedType')} />
          {type === 'PERCENTAGE' ? (
            <>
              <Field label="Percentage *" type="number" step="0.01" min={0} max={100} {...register('percentage', { required: 'Enter a percentage' })} error={err('percentage')} />
              <Field label="Minimum ₹ (0 = none)" type="number" step="0.01" min={0} {...register('minimumAmount')} error={err('minimumAmount')} />
              <Field label="Maximum ₹ (0 = none)" type="number" step="0.01" min={0} {...register('maximumAmount')} error={err('maximumAmount')} />
            </>
          ) : (
            <Field label="Amount ₹ per month *" type="number" step="0.01" min={0} {...register('assignedAmount', { required: 'Enter an amount' })} error={err('assignedAmount')} />
          )}
          <Field label={startRequired ? 'Effective from *' : 'Effective from'} type="date" {...register('effectiveFrom', { required: startRequired && 'Enter a date' })} error={err('effectiveFrom')} />
        </fieldset>
        {mode !== 'revise' && (
          <fieldset disabled={viewOnly} className="grid grid-cols-2 gap-3">
            <Field label="Effective to (optional)" type="date" {...register('effectiveTo')} error={err('effectiveTo')} />
          </fieldset>
        )}
        {viewOnly && row && (
          <p className="text-xs text-ink-500">Entered by {row.created_by} on {new Date(row.created_at).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}</p>
        )}
        {save.isError && !fieldErrors(save.error) && <p role="alert" className="rounded-lg bg-danger-50 px-3 py-2 text-sm text-danger-700">{errorMessage(save.error)}</p>}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>{viewOnly ? 'Close' : 'Cancel'}</Button>
          {!viewOnly && <Button type="submit" disabled={save.isPending || (mode === 'edit' && detail.isLoading)}>{save.isPending ? 'Saving…' : 'Save'}</Button>}
        </div>
      </form>
    </Modal>
  );
}

/** Find by name or code; the list is too long for a drop-down. Leavers are included: their last month is still paid. */
function EmployeePicker({ value: chosen, onChange, error }: { value: EmployeeListItem | null; onChange: (e: EmployeeListItem | null) => void; error?: string }) {
  const [q, setQ] = useState('');
  const term = q.trim();
  const found = useQuery({
    queryKey: ['employee-picker', term],
    queryFn: () => hrApi.employees.list({ q: term, status: 'all', pageSize: 8 }),
    enabled: !chosen && term.length > 0,
    placeholderData: keepPreviousData,
  });

  if (chosen)
    return (
      <div>
        <span className="field-label">Employee *</span>
        <div className="flex items-center justify-between gap-3 rounded-lg border border-ink-200 px-3 py-2 text-sm">
          <span><b>{chosen.employee_name}</b> <span className="text-ink-500">· {chosen.employee_code} · {chosen.designation_name}</span></span>
          <button type="button" className="text-xs font-semibold text-brand-700" onClick={() => onChange(null)}>Change</button>
        </div>
        {error && <p className="field-error">{error}</p>}
      </div>
    );
  return (
    <div>
      <Field id="employee-search" label="Employee *" placeholder="Type a name or code" autoComplete="off" autoFocus value={q} onChange={(e) => setQ(e.target.value)} error={error} />
      {term && (
        <ul className="mt-1 max-h-48 divide-y divide-ink-100 overflow-y-auto rounded-lg border border-ink-200 text-sm">
          {(found.data?.items ?? []).map((e) => (
            <li key={e.id}>
              <button type="button" className="block w-full px-3 py-2 text-left hover:bg-brand-25" onClick={() => onChange(e)}>
                <b>{e.employee_name}</b> <span className="text-ink-500">· {e.employee_code} · {e.designation_name}{e.date_of_leaving && ` · left ${formatDate(e.date_of_leaving)}`}</span>
              </button>
            </li>
          ))}
          {found.data?.items.length === 0 && <li className="px-3 py-2 text-ink-500">No employee found</li>}
          {found.isError && <li className="px-3 py-2 text-danger-700">{errorMessage(found.error)}</li>}
          {(found.data?.total ?? 0) > 8 && <li className="px-3 py-2 text-xs text-ink-500">{found.data!.total - 8} more; type more to narrow</li>}
        </ul>
      )}
    </div>
  );
}

function DeactivateDialog({ row, onClose, onDone }: { row: ComponentAssignment; onClose: () => void; onDone: () => void }) {
  const del = useMutation({ mutationFn: () => payrollApi.assignments.deactivate(row.id), onSuccess: onDone });
  return (
    <Modal open title="Deactivate assignment?" onClose={onClose}>
      <p className="text-sm text-ink-700">
        {row.component_name} of {value(row)} for <b>{row.employee_name}</b>, {startText(row.effective_from)}, will no longer be used. To stop it from a date instead, edit it and enter an end date.
      </p>
      {del.isError && <p role="alert" className="mt-3 rounded-lg bg-danger-50 px-3 py-2 text-sm text-danger-700">{errorMessage(del.error)}</p>}
      <div className="mt-5 flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button variant="danger" disabled={del.isPending} onClick={() => del.mutate()}>{del.isPending ? 'Deactivating…' : 'Deactivate'}</Button>
      </div>
    </Modal>
  );
}
