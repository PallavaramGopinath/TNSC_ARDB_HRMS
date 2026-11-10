import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createColumnHelper } from '@tanstack/react-table';
import { Check, Lock, Pencil, Plus, Power, Trash2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { DataTable } from '@/components/ui/DataTable';
import { Field } from '@/components/ui/Field';
import { Modal } from '@/components/ui/Modal';
import { PageHeader } from '@/components/ui/PageHeader';
import { useAuth } from '@/hooks/useAuth';
import { formatINR } from '@/lib/format';
import { errorMessage, fieldErrors } from '@/services/api';
import { payrollApi, type PayrollComponentInput } from '@/services/payroll';
import type { PayrollComponent } from '@/types/api';

const TYPE = { 1: ['Earnings', 'success'], 2: ['Deductions', 'warning'], 3: ['Loan deductions', 'danger'] } as const;
const col = createColumnHelper<PayrollComponent>();

const Tick = ({ on }: { on: boolean }) => (on ? <Check size={16} className="text-success-600" aria-label="Yes" /> : <span className="text-ink-300" aria-label="No">—</span>);
const limit = (v: string) => (Number(v) === 0 ? '—' : formatINR(v));

/** Payroll components (pay heads). Locked codes are the ones the payroll calculator depends on. */
export function ComponentsPage() {
  const qc = useQueryClient();
  const { user } = useAuth();
  const canEdit = !!user && (user.isAdmin || user.roles.includes('Payroll'));
  const [showInactive, setShowInactive] = useState(false);
  const [editing, setEditing] = useState<PayrollComponent | 'new' | null>(null);
  const [deleting, setDeleting] = useState<PayrollComponent | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const { data = [], isLoading } = useQuery({
    queryKey: ['payroll-components', showInactive],
    queryFn: () => payrollApi.components.list({ includeInactive: showInactive }),
  });
  const refresh = () => qc.invalidateQueries({ queryKey: ['payroll-components'] });

  const toggle = useMutation({
    mutationFn: (c: PayrollComponent) => payrollApi.components.setActive(c.id, !c.is_active),
    onSuccess: () => { setActionError(null); void refresh(); },
    onError: (e) => setActionError(errorMessage(e)),
  });

  const columns = useMemo(
    () => [
      col.accessor('display_order', { header: 'Order', cell: (c) => <span className="tabular-nums">{c.getValue() ?? '—'}</span> }),
      col.accessor('component_code', {
        header: 'Code',
        cell: (c) => (
          <span className="inline-flex items-center gap-1.5">
            <code className="text-xs font-semibold">{c.getValue()}</code>
            {c.row.original.is_system && <span title="System component — used by the payroll calculator"><Lock size={12} className="text-ink-400" /></span>}
          </span>
        ),
      }),
      col.accessor('component_name', { header: 'Name' }),
      col.accessor('component_type', { header: 'Type', cell: (c) => <Badge tone={TYPE[c.getValue()][1]}>{TYPE[c.getValue()][0]}</Badge> }),
      col.accessor('is_da_applicable', { header: 'DA base', cell: (c) => <Tick on={c.getValue()} /> }),
      col.accessor('is_surrender_leave_applicable', { header: 'SLS base', cell: (c) => <Tick on={c.getValue()} /> }),
      col.accessor('is_income_tax_applicable', { header: 'Taxable', cell: (c) => <Tick on={c.getValue()} /> }),
      col.accessor('minimum_amount', { header: 'Min', cell: (c) => <span className="tabular-nums">{limit(c.getValue())}</span> }),
      col.accessor('maximum_amount', { header: 'Max', cell: (c) => <span className="tabular-nums">{limit(c.getValue())}</span> }),
      col.accessor('usage_count', { header: 'In use', cell: (c) => <span className="tabular-nums">{c.getValue()}</span> }),
      col.accessor('is_active', { header: 'Status', cell: (c) => (c.getValue() ? <Badge tone="success">Active</Badge> : <Badge>Inactive</Badge>) }),
      col.display({
        id: 'actions',
        header: '',
        cell: ({ row: { original: c } }) => {
          if (!canEdit) return null;
          const deleteBlock = c.is_system ? 'System component — cannot be deleted' : c.usage_count > 0 ? 'In use — deactivate instead' : null;
          const toggleBlock = c.is_system && c.is_active ? 'System component — cannot be deactivated' : null;
          return (
            <div className="flex justify-end gap-1">
              <Button variant="ghost" aria-label={`Edit ${c.component_name}`} title="Edit" onClick={() => setEditing(c)}><Pencil size={14} /></Button>
              <Button variant="ghost" aria-label={`${c.is_active ? 'Deactivate' : 'Activate'} ${c.component_name}`} title={toggleBlock ?? (c.is_active ? 'Deactivate' : 'Activate')} disabled={!!toggleBlock} onClick={() => toggle.mutate(c)}>
                <Power size={14} className={toggleBlock ? 'text-ink-300' : c.is_active ? 'text-ink-500' : 'text-success-600'} />
              </Button>
              <Button variant="ghost" aria-label={`Delete ${c.component_name}`} title={deleteBlock ?? 'Delete permanently'} disabled={!!deleteBlock} onClick={() => setDeleting(c)}>
                <Trash2 size={14} className={deleteBlock ? 'text-ink-300' : 'text-danger-600'} />
              </Button>
            </div>
          );
        },
      }),
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [canEdit],
  );

  return (
    <>
      <PageHeader
        title="Payroll components"
        subtitle="Pay heads recognised by the calculator · locked codes are system components"
        actions={canEdit && <Button onClick={() => setEditing('new')}><Plus size={16} /> New component</Button>}
      />
      <label className="mb-4 flex items-center gap-2 text-sm text-ink-600">
        <input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} className="accent-brand-600" /> Show inactive
      </label>
      {actionError && <p role="alert" className="mb-3 rounded-lg bg-danger-50 px-3 py-2 text-sm text-danger-700">{actionError}</p>}
      <DataTable data={data} columns={columns} loading={isLoading} empty="No payroll components" />

      {editing && (
        <ComponentForm
          initial={editing === 'new' ? null : editing}
          nextOrder={nextOrder(data)}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); void refresh(); }}
        />
      )}
      {deleting && <ConfirmDelete component={deleting} onClose={() => setDeleting(null)} onDeleted={() => { setDeleting(null); void refresh(); }} />}
    </>
  );
}

/** Suggest the next multiple of 10 after the highest display order, so a new pay head sorts last. */
const nextOrder = (rows: PayrollComponent[]) => {
  const max = Math.max(0, ...rows.map((r) => r.display_order ?? 0));
  return String(Math.ceil((max + 1) / 10) * 10);
};

const FLAGS: Array<{ name: 'isDaApplicable' | 'isSurrenderLeaveApplicable' | 'isIncomeTaxApplicable'; label: string; help: string }> = [
  { name: 'isDaApplicable', label: 'Part of DA base', help: 'Dearness Allowance is calculated on this pay head.' },
  { name: 'isSurrenderLeaveApplicable', label: 'Part of SLS base', help: 'Included when computing Surrender Leave Salary.' },
  { name: 'isIncomeTaxApplicable', label: 'Taxable', help: 'Counted as taxable income for Income Tax.' },
];

type FormValues = Omit<PayrollComponentInput, 'componentType' | 'displayOrder' | 'calculationMethod' | 'calculationBasis' | 'minimumAmount' | 'maximumAmount'> & {
  componentType: string;
  displayOrder: string;
  calculationMethod: string;
  calculationBasis: string;
  minimumAmount: string;
  maximumAmount: string;
};

function ComponentForm({ initial, nextOrder, onClose, onSaved }: { initial: PayrollComponent | null; nextOrder: string; onClose: () => void; onSaved: () => void }) {
  const system = !!initial?.is_system;
  const { register, handleSubmit, setError, formState } = useForm<FormValues>({
    defaultValues: {
      componentName: initial?.component_name ?? '',
      componentCode: initial?.component_code ?? '',
      componentType: String(initial?.component_type ?? 1),
      displayOrder: initial ? (initial.display_order === null ? '' : String(initial.display_order)) : nextOrder,
      calculationMethod: initial?.calculation_method ?? '',
      calculationBasis: initial?.calculation_basis ?? '',
      minimumAmount: initial ? String(Number(initial.minimum_amount)) : '0',
      maximumAmount: initial ? String(Number(initial.maximum_amount)) : '0',
      isDaApplicable: initial?.is_da_applicable ?? false,
      isSurrenderLeaveApplicable: initial?.is_surrender_leave_applicable ?? false,
      isIncomeTaxApplicable: initial?.is_income_tax_applicable ?? false,
      isActive: initial?.is_active ?? true,
    },
  });
  const [err, setErr] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: (v: FormValues) => {
      const body: PayrollComponentInput = {
        ...v,
        componentCode: v.componentCode.trim().toUpperCase(),
        // A disabled <select> is not submitted, so a system component keeps its stored type.
        componentType: system && initial ? initial.component_type : (Number(v.componentType) as 1 | 2 | 3),
        displayOrder: v.displayOrder.trim() === '' ? null : v.displayOrder,
        calculationMethod: v.calculationMethod.trim() || null,
        calculationBasis: v.calculationBasis.trim() || null,
        isActive: system ? undefined : v.isActive,
      };
      return initial ? payrollApi.components.update(initial.id, body) : payrollApi.components.create(body);
    },
    onSuccess: onSaved,
    onError: (e) => {
      const fe = fieldErrors(e);
      if (fe) for (const [f, m] of Object.entries(fe)) setError(f as keyof FormValues, { message: m[0] });
      else setErr(errorMessage(e));
    },
  });

  return (
    <Modal open title={initial ? `Edit ${initial.component_code}` : 'New payroll component'} onClose={onClose}>
      <form onSubmit={handleSubmit((v) => { setErr(null); save.mutate(v); })} className="space-y-4" noValidate>
        <div className="grid grid-cols-3 gap-3">
          <div>
            <Field
              label="Code"
              maxLength={20}
              className="field-input font-mono uppercase"
              readOnly={system}
              placeholder="e.g. TA"
              {...register('componentCode', { required: 'Component code is required', pattern: { value: /^[A-Za-z0-9_ ]{1,20}$/, message: 'Letters, digits, _ or space' } })}
              error={formState.errors.componentCode?.message}
            />
            {system && !formState.errors.componentCode && <p className="mt-1 text-xs text-ink-500">System code — locked</p>}
          </div>
          <div className="col-span-2">
            <Field
              label="Component name"
              autoFocus
              maxLength={100}
              {...register('componentName', { required: 'Component name is required', validate: (v) => v.trim() !== '' || 'Component name is required' })}
              error={formState.errors.componentName?.message}
            />
          </div>
        </div>
        <div className="grid grid-cols-3 gap-3">
          <div className="col-span-2">
            <label htmlFor="componentType" className="field-label">Type</label>
            <select id="componentType" className="field-input" disabled={system} {...register('componentType')}>
              <option value="1">Earnings</option>
              <option value="2">Deductions</option>
              <option value="3">Loan deductions</option>
            </select>
            {formState.errors.componentType && <p className="field-error">{formState.errors.componentType.message}</p>}
          </div>
          <Field label="Display order" type="number" min={0} step={1} {...register('displayOrder', { min: { value: 0, message: 'Cannot be negative' } })} error={formState.errors.displayOrder?.message} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Calculation method (optional)" maxLength={50} placeholder="e.g. FIXED / PERCENTAGE" {...register('calculationMethod')} error={formState.errors.calculationMethod?.message} />
          <Field label="Calculation basis (optional)" maxLength={255} placeholder="e.g. % of Basic" {...register('calculationBasis')} error={formState.errors.calculationBasis?.message} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Minimum amount (₹)" type="number" min={0} step="0.01" {...register('minimumAmount', { min: { value: 0, message: 'Cannot be negative' } })} error={formState.errors.minimumAmount?.message} />
          <Field label="Maximum amount (₹, 0 = no limit)" type="number" min={0} step="0.01" {...register('maximumAmount', { min: { value: 0, message: 'Cannot be negative' } })} error={formState.errors.maximumAmount?.message} />
        </div>
        <fieldset className="space-y-2 rounded-lg border border-ink-200 p-3">
          <legend className="px-1 text-xs font-semibold uppercase tracking-wide text-ink-500">Applicability</legend>
          {FLAGS.map((f) => (
            <label key={f.name} className="flex items-start gap-2 text-sm">
              <input type="checkbox" className="mt-0.5 accent-brand-600" {...register(f.name)} />
              <span><span className="font-medium text-ink-800">{f.label}</span><span className="block text-xs text-ink-500">{f.help}</span></span>
            </label>
          ))}
        </fieldset>
        {!system && (
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="accent-brand-600" {...register('isActive')} /> Active</label>
        )}
        {err && <p role="alert" className="rounded-lg bg-danger-50 px-3 py-2 text-sm text-danger-700">{err}</p>}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit" disabled={save.isPending}>{save.isPending ? 'Saving…' : 'Save'}</Button>
        </div>
      </form>
    </Modal>
  );
}

function ConfirmDelete({ component, onClose, onDeleted }: { component: PayrollComponent; onClose: () => void; onDeleted: () => void }) {
  const del = useMutation({ mutationFn: () => payrollApi.components.remove(component.id), onSuccess: onDeleted });
  return (
    <Modal open title="Delete payroll component permanently?" onClose={onClose}>
      <p className="text-sm text-ink-700"><b>{component.component_name}</b> ({component.component_code}) will be removed. This cannot be undone.</p>
      {del.isError && <p role="alert" className="mt-3 rounded-lg bg-danger-50 px-3 py-2 text-sm text-danger-700">{errorMessage(del.error)}</p>}
      <div className="mt-5 flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button variant="danger" disabled={del.isPending} onClick={() => del.mutate()}>{del.isPending ? 'Deleting…' : 'Delete'}</Button>
      </div>
    </Modal>
  );
}
