import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createColumnHelper } from '@tanstack/react-table';
import { Ban, Eye, Pencil, Plus, RefreshCw } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { DataTable } from '@/components/ui/DataTable';
import { Field } from '@/components/ui/Field';
import { Modal } from '@/components/ui/Modal';
import { PageHeader } from '@/components/ui/PageHeader';
import { Select, type Option } from '@/components/ui/Select';
import { useAuth } from '@/hooks/useAuth';
import { formatDate, formatINR, humanize } from '@/lib/format';
import { COMPONENT_TYPE, componentLabel, isAssignable } from '@/lib/payrollComponents';
import { errorMessage, fieldErrors } from '@/services/api';
import { hrApi } from '@/services/hr';
import { payrollApi, type AssignmentInput } from '@/services/payroll';
import type { AssignedType, ComponentAssignment, ComponentAssignmentDetail, EmployeeListItem, HraCcaStatus, Paged } from '@/types/api';

/**
 * Payroll › Masters › Component Assignments (docs §3.1, spec 07): what one employee is paid, or has deducted, under
 * a component — a fixed amount or a percentage, with effective dates. The employee is chosen first; their earnings
 * and deductions are then added one by one.
 */
const col = createColumnHelper<ComponentAssignment>();
const PAGE_SIZE = 200; // the most the API returns at a time
const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
const statusTone: Record<HraCcaStatus, 'success' | 'brand' | 'neutral' | 'danger'> = { CURRENT: 'success', FUTURE: 'brand', EXPIRED: 'neutral', INACTIVE: 'danger' };
const typeOptions: Option[] = [{ value: 'FIXED', label: 'Fixed amount' }, { value: 'PERCENTAGE', label: 'Percentage' }];

/** '₹500.00' or '7.5%', with the limits of a percentage if it has any. */
const limits = (r: ComponentAssignment) =>
  [Number(r.minimum_amount) > 0 && `min ${formatINR(r.minimum_amount)}`, Number(r.maximum_amount) > 0 && `max ${formatINR(r.maximum_amount)}`].filter(Boolean).join(', ');
const value = (r: ComponentAssignment) => (r.assigned_type === 'FIXED' ? formatINR(r.assigned_amount) : `${Number(r.percentage)}%`);
const startText = (d: string | null) => (d ? `from ${formatDate(d)}` : 'with no start date');

const employeeLabel = (e: EmployeeListItem) => `${e.employee_code} — ${e.employee_name}${e.date_of_leaving ? ` (left ${formatDate(e.date_of_leaving)})` : ''}`;
/** In force now or later. A component is assigned only once at a time, so it is not offered again meanwhile. */
const notEnded = (r: ComponentAssignment) => r.status === 'CURRENT' || r.status === 'FUTURE';

async function allPages<T>(load: (page: number) => Promise<Pick<Paged<T>, 'items' | 'total'>>): Promise<T[]> {
  const items: T[] = [];
  for (let page = 1; ; page++) {
    const r = await load(page);
    items.push(...r.items);
    if (r.items.length === 0 || items.length >= r.total) return items;
  }
}

type FormMode = 'add' | 'edit' | 'revise' | 'view';
interface FormState { mode: FormMode; row?: ComponentAssignment }

export function ComponentAssignmentsPage() {
  const qc = useQueryClient();
  const { user } = useAuth();
  const canEdit = !!user && (user.isAdmin || user.roles.includes('Payroll'));
  const [employeeId, setEmployeeId] = useState('');
  const [active, setActive] = useState(true);
  const [form, setForm] = useState<FormState | null>(null);
  const [deactivating, setDeactivating] = useState<ComponentAssignment | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const components = useQuery({ queryKey: ['payroll-components', false], queryFn: () => payrollApi.components.list({ includeInactive: false }) });
  // Leavers are included: their last month is still paid.
  const employees = useQuery({
    queryKey: ['employee-options'],
    queryFn: () => allPages((page) => hrApi.employees.list({ status: 'all', page, pageSize: PAGE_SIZE })),
  });
  const employee = employees.data?.find((e) => String(e.id) === employeeId);
  // Everything the employee has, whatever the filter: what is already assigned must not depend on it.
  const listQ = useQuery({
    queryKey: ['component-assignments', employeeId],
    queryFn: () => allPages((page) => payrollApi.assignments.list({ employeeId: Number(employeeId), status: 'ALL', page, size: PAGE_SIZE })),
    enabled: !!employeeId,
  });

  const rows = useMemo(() => (listQ.data ?? []).filter((r) => r.is_active === active), [listQ.data, active]);
  const assigned = new Set((listQ.data ?? []).filter(notEnded).map((r) => r.component_id));
  const toAdd: Option[] = (components.data ?? [])
    .filter((c) => isAssignable(c.component_code) && !assigned.has(c.id))
    .map((c) => ({ value: c.id, label: componentLabel(c) }));
  const loadError = employees.error ?? components.error ?? listQ.error;

  const refresh = (msg?: string) => {
    setNotice(msg ?? null);
    for (const key of ['component-assignments', 'component-assignment', 'allowance-preview', 'payroll-components']) void qc.invalidateQueries({ queryKey: [key] });
  };

  const columns = useMemo(
    () => [
      col.accessor('component_code', { header: 'Code', cell: (c) => <code className="text-xs font-semibold">{c.getValue()}</code> }),
      col.accessor('component_name', { header: 'Component' }),
      col.accessor('component_type', { header: 'Type', cell: (c) => <Badge tone={COMPONENT_TYPE[c.getValue()][1]}>{COMPONENT_TYPE[c.getValue()][0]}</Badge> }),
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
          const editable = canEdit && notEnded(r);
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
        subtitle="Earnings and deductions of an employee, added one by one"
        actions={canEdit ? <Button disabled={!employee || !listQ.isSuccess || !components.isSuccess} onClick={() => setForm({ mode: 'add' })}><Plus size={16} /> Add assignment</Button> : undefined}
      />

      <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-[2fr_1fr] lg:max-w-3xl">
        <Select
          id="f-employee"
          label="Employee"
          placeholder={employees.isLoading ? 'Loading…' : 'Select employee'}
          options={(employees.data ?? []).map((e) => ({ value: e.id, label: employeeLabel(e) }))}
          value={employeeId}
          onChange={(e) => { setEmployeeId(e.target.value); setNotice(null); }}
        />
        <div>
          <label htmlFor="f-active" className="field-label">Show</label>
          <select id="f-active" className="field-input" value={active ? 'ACTIVE' : 'INACTIVE'} onChange={(e) => setActive(e.target.value === 'ACTIVE')}>
            <option value="ACTIVE">Active</option>
            <option value="INACTIVE">Inactive</option>
          </select>
        </div>
      </div>

      {notice && (
        <p role="status" className="mb-3 flex items-start justify-between gap-3 rounded-lg bg-warning-50 px-3 py-2 text-sm text-warning-700">
          <span>{notice}</span>
          <button type="button" className="text-xs font-semibold" onClick={() => setNotice(null)}>Dismiss</button>
        </p>
      )}
      {loadError && <p role="alert" className="mb-3 rounded-lg bg-danger-50 px-3 py-2 text-sm text-danger-700">{errorMessage(loadError)}</p>}

      {!employeeId ? (
        <p className="text-sm text-ink-500">Select an employee above to view their component assignments.</p>
      ) : (
        <>
          <DataTable data={rows} columns={columns} loading={listQ.isLoading} empty={active ? 'No active assignments' : 'No inactive assignments'} />
          {listQ.isSuccess && <p className="mt-2 text-sm text-ink-500">{rows.length} {rows.length === 1 ? 'assignment' : 'assignments'}</p>}
        </>
      )}

      {form && employee && (
        <AssignmentForm
          state={form}
          employee={employee}
          toAdd={toAdd}
          onClose={() => setForm(null)}
          onAdded={() => refresh()}
          onSaved={(warnings) => { setForm(null); refresh(warnings.length ? warnings.join(' ') : undefined); }}
        />
      )}
      {deactivating && <DeactivateDialog row={deactivating} onClose={() => setDeactivating(null)} onDone={() => { setDeactivating(null); refresh(); }} />}
    </>
  );
}

interface FormValues {
  employeeId: string; // not a field; here so that errors can be attached to it
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

function AssignmentForm({ state, employee, toAdd, onClose, onAdded, onSaved }: {
  state: FormState;
  employee: EmployeeListItem;
  /** Components the employee does not have yet. */
  toAdd: Option[];
  onClose: () => void;
  /** Saved, and the dialog stays open for the next one. */
  onAdded: () => void;
  onSaved: (warnings: string[]) => void;
}) {
  const { mode, row } = state;
  const adding = mode === 'add';
  const [added, setAdded] = useState<ComponentAssignmentDetail[]>([]);
  const busy = useRef(false); // a second click can come before the buttons are redrawn as disabled
  const detail = useQuery({ queryKey: ['component-assignment', row?.id], queryFn: () => payrollApi.assignments.get(row!.id), enabled: !!row, staleTime: 0, gcTime: 0 });
  const viewOnly = mode === 'view';
  const locked = mode === 'edit' && !!detail.data?.usedInFinalisedPayroll;

  const { register, handleSubmit, setError, clearErrors, setFocus, reset, watch, formState } = useForm<FormValues>({
    defaultValues: {
      employeeId: '',
      componentId: '',
      assignedType: row?.assigned_type ?? 'FIXED',
      assignedAmount: row?.assigned_type === 'FIXED' ? String(Number(row.assigned_amount)) : '',
      percentage: num(row?.percentage),
      minimumAmount: num(row?.minimum_amount),
      maximumAmount: num(row?.maximum_amount),
      effectiveFrom: adding ? today() : mode === 'revise' ? '' : row?.effective_from ?? '',
      effectiveTo: mode === 'revise' ? '' : row?.effective_to ?? '',
    },
  });
  const err = (k: keyof FormValues) => formState.errors[k]?.message;
  const type = watch('assignedType');
  const startRequired = mode !== 'edit' || row?.effective_from !== null;

  // The list behind the dialog is read again after each save; until it arrives, leave out what was just added.
  const justAdded = new Set(added.filter(notEnded).map((r) => r.component_id));
  const options = toAdd.filter((o) => !justAdded.has(Number(o.value)));

  const save = useMutation({
    mutationFn: ({ values: { employeeId: _e, componentId, effectiveTo, ...v } }: { values: FormValues; addNext: boolean }) => {
      const terms: AssignmentInput = { ...v, assignedType: v.assignedType as AssignedType };
      if (mode === 'revise') return payrollApi.assignments.revise(row!.id, terms);
      const body = { ...terms, effectiveTo };
      return adding ? payrollApi.assignments.create({ ...body, employeeId: employee.id, componentId }) : payrollApi.assignments.update(row!.id, body);
    },
    onSuccess: (r, { values: { effectiveFrom, effectiveTo }, addNext }) => {
      if (!addNext) return onSaved(r.warnings ?? []);
      setAdded((list) => [...list, r]);
      reset({ employeeId: '', componentId: '', assignedType: 'FIXED', assignedAmount: '', percentage: '', minimumAmount: '', maximumAmount: '', effectiveFrom, effectiveTo });
      onAdded();
    },
    onError: (e) => {
      const fe = fieldErrors(e);
      if (fe) for (const [f, m] of Object.entries(fe)) setError(f as keyof FormValues, { message: m[0] });
    },
    onSettled: () => { busy.current = false; },
  });
  useEffect(() => { if (adding && save.isSuccess) setFocus('componentId'); }, [adding, save.isSuccess, setFocus]);

  const submit = (addNext: boolean) => {
    clearErrors();
    void handleSubmit((values) => {
      if (busy.current) return;
      busy.current = true;
      save.mutate({ values, addNext });
    })();
  };
  const close = () => { if (!save.isPending) onClose(); };
  const nothingLeft = adding && options.length === 0 && !save.isPending;

  const title = { add: 'Add assignment', edit: 'Edit assignment', revise: 'Revise assignment', view: 'Assignment' }[mode];
  return (
    <Modal open title={title} onClose={close}>
      <form noValidate className="space-y-4" onSubmit={(e) => { e.preventDefault(); if (!nothingLeft) submit(adding); }}>
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
          <dt className="text-ink-500">Employee</dt><dd className="font-semibold">{employee.employee_name} ({employee.employee_code})</dd>
          {row && <><dt className="text-ink-500">Component</dt><dd className="font-semibold">{componentLabel(row)}</dd></>}
        </dl>
        {err('employeeId') && <p className="field-error">{err('employeeId')}</p>}
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
        {nothingLeft ? (
          <p className="rounded-lg bg-brand-25 px-3 py-2 text-sm text-ink-700">All components that can be assigned have been assigned to this employee.</p>
        ) : (
          <>
            {adding && (
              <fieldset disabled={save.isPending}>
                <Select
                  label="Component *"
                  placeholder="Select component"
                  options={options}
                  hint="DA, HRA, CCA, MA, Employer PF, Bonus, Ex-Gratia, SLS and Gratuity are handled by payroll and are not assigned here."
                  {...register('componentId', { required: 'Select a component.' })}
                  error={err('componentId')}
                />
              </fieldset>
            )}
            <fieldset disabled={viewOnly || locked || save.isPending} className="grid grid-cols-2 gap-3">
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
              <fieldset disabled={viewOnly || save.isPending} className="grid grid-cols-2 gap-3">
                <Field label="Effective to (optional)" type="date" {...register('effectiveTo')} error={err('effectiveTo')} />
              </fieldset>
            )}
          </>
        )}
        {viewOnly && row && (
          <p className="text-xs text-ink-500">Entered by {row.created_by} on {new Date(row.created_at).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}</p>
        )}
        {save.isError && !fieldErrors(save.error) && <p role="alert" className="rounded-lg bg-danger-50 px-3 py-2 text-sm text-danger-700">{errorMessage(save.error)}</p>}
        {adding && (
          <div className="text-sm text-ink-600">
            {added.length > 0 && (
              <ul aria-label="Added" className="mb-2 max-h-40 divide-y divide-ink-100 overflow-y-auto rounded-lg border border-ink-200">
                {added.map((r) => (
                  <li key={r.id} className="px-3 py-1.5">
                    <span className="flex justify-between gap-3"><span>{componentLabel(r)}</span><b className="whitespace-nowrap tabular-nums">{value(r)}</b></span>
                    {r.warnings?.map((w) => <span key={w} className="block text-xs text-warning-700">{w}</span>)}
                  </li>
                ))}
              </ul>
            )}
            <p role="status" className="text-xs text-ink-500">{added.length ? `${added.length} added` : 'None added yet'} · {options.length} remaining</p>
          </div>
        )}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" disabled={save.isPending} onClick={close}>{viewOnly || added.length || nothingLeft ? 'Close' : 'Cancel'}</Button>
          {adding && !nothingLeft && (
            <>
              <Button variant="secondary" disabled={save.isPending} onClick={() => submit(false)}>Save</Button>
              <Button type="submit" disabled={save.isPending}>{save.isPending ? 'Saving…' : 'Save & add next'}</Button>
            </>
          )}
          {!adding && !viewOnly && <Button type="submit" disabled={save.isPending || (mode === 'edit' && detail.isLoading)}>{save.isPending ? 'Saving…' : 'Save'}</Button>}
        </div>
      </form>
    </Modal>
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
