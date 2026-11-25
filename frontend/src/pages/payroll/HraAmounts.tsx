import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createColumnHelper } from '@tanstack/react-table';
import { AlertTriangle, Ban, Eye, Info, Pencil, Plus, RefreshCw } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link } from 'react-router-dom';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { DataTable } from '@/components/ui/DataTable';
import { Field } from '@/components/ui/Field';
import { Modal } from '@/components/ui/Modal';
import { PageHeader } from '@/components/ui/PageHeader';
import { Select, type Option } from '@/components/ui/Select';
import { TextArea } from '@/components/ui/TextArea';
import { useAuth } from '@/hooks/useAuth';
import { formatDate, formatINR, humanize } from '@/lib/format';
import { errorMessage, fieldErrors } from '@/services/api';
import { hrApi } from '@/services/hr';
import { payrollApi, type HraAmountInput } from '@/services/payroll';
import type { HraAmount, HraCcaStatus } from '@/types/api';

/**
 * Payroll › Masters › HRA Amounts (specs/06 §5, §12.1): a monthly amount per designation for Greater Chennai
 * Corporation and one for every other place. Used when the HRA method is "Fixed amount"; can be entered before.
 */
const col = createColumnHelper<HraAmount>();
const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
const statusTone: Record<HraCcaStatus, 'success' | 'brand' | 'neutral' | 'danger'> = { CURRENT: 'success', FUTURE: 'brand', EXPIRED: 'neutral', INACTIVE: 'danger' };
const statusOptions: Option[] = [...['CURRENT', 'FUTURE', 'EXPIRED', 'INACTIVE'].map((v) => ({ value: v, label: humanize(v) })), { value: 'ALL', label: 'All' }];
const rupees = (header: string) => () => <span className="block text-right">{header}</span>;
const amountCell = (v: string) => <span className="block text-right font-semibold tabular-nums">{formatINR(v)}</span>;

type FormMode = 'add' | 'edit' | 'revise' | 'view';
interface FormState { mode: FormMode; row?: HraAmount; designationId?: number }

export function HraAmountsPage() {
  const qc = useQueryClient();
  const { user } = useAuth();
  const canEdit = !!user && (user.isAdmin || user.roles.includes('Payroll'));
  const [status, setStatus] = useState('CURRENT');
  const [asOn, setAsOn] = useState(today());
  const [search, setSearch] = useState('');
  const [form, setForm] = useState<FormState | null>(null);
  const [deactivating, setDeactivating] = useState<HraAmount | null>(null);
  const [showMissing, setShowMissing] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const methodQ = useQuery({ queryKey: ['hra-cca-basis'], queryFn: payrollApi.hraCcaBasis.status });
  const designations = useQuery({ queryKey: ['designations', '', false], queryFn: () => hrApi.designations.list(), staleTime: 60_000 });
  const params = { status, asOn: asOn || undefined, search: search || undefined };
  const listQ = useQuery({ queryKey: ['hra-amounts', params], queryFn: () => payrollApi.hraAmounts.list(params) });
  const missingQ = useQuery({ queryKey: ['hra-amounts-missing', asOn], queryFn: () => payrollApi.hraAmounts.missing(asOn || undefined) });
  const missing = missingQ.data?.missing ?? [];

  const refresh = (msg?: string) => {
    setNotice(msg ?? null);
    for (const key of ['hra-amounts', 'hra-amounts-missing', 'hra-cca-basis', 'hra-cca-missing']) void qc.invalidateQueries({ queryKey: [key] });
  };

  const columns = useMemo(
    () => [
      col.accessor('designation_name', { header: 'Designation', cell: (c) => <span className="font-medium">{c.getValue()}</span> }),
      col.accessor('gcc_amount', { header: rupees('Greater Chennai'), cell: (c) => amountCell(c.getValue()) }),
      col.accessor('other_amount', { header: rupees('Other places'), cell: (c) => amountCell(c.getValue()) }),
      col.accessor('effective_from', { header: 'Eff. from', cell: (c) => formatDate(c.getValue()) }),
      col.accessor('effective_to', { header: 'Eff. to', cell: (c) => formatDate(c.getValue()) }),
      col.accessor('status', { header: 'Status', cell: (c) => <Badge tone={statusTone[c.getValue()]}>{humanize(c.getValue())}</Badge> }),
      col.accessor('remarks', { header: 'Remarks', cell: (c) => <span className="block max-w-[16rem] truncate text-ink-600" title={c.getValue() ?? ''}>{c.getValue() ?? '—'}</span> }),
      col.display({
        id: 'actions',
        header: '',
        cell: (c) => {
          const r = c.row.original;
          const editable = canEdit && (r.status === 'CURRENT' || r.status === 'FUTURE');
          return (
            <div className="flex justify-end gap-1">
              {editable ? (
                <>
                  <Button variant="ghost" title="Edit" aria-label={`Edit amount for ${r.designation_name}`} onClick={() => setForm({ mode: 'edit', row: r })}><Pencil size={14} /></Button>
                  <Button variant="ghost" title="Revise" aria-label={`Revise amount for ${r.designation_name}`} onClick={() => setForm({ mode: 'revise', row: r })}><RefreshCw size={14} /></Button>
                  <Button variant="ghost" title="Deactivate" aria-label={`Deactivate amount for ${r.designation_name}`} onClick={() => setDeactivating(r)}><Ban size={14} /></Button>
                </>
              ) : (
                <Button variant="ghost" title="View" aria-label={`View amount for ${r.designation_name}`} onClick={() => setForm({ mode: 'view', row: r })}><Eye size={14} /></Button>
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
        title="HRA Amounts"
        subtitle="Fixed monthly House Rent Allowance by designation and place"
        actions={canEdit ? <Button onClick={() => setForm({ mode: 'add' })}><Plus size={16} /> Add amount</Button> : undefined}
      />

      {methodQ.data && methodQ.data.method !== 'FIXED_AMOUNT' && (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-lg bg-warning-50 px-4 py-3 text-sm text-warning-700">
          <span className="flex items-center gap-2"><Info size={16} /> These amounts are not used yet: HRA is paid as a percentage. Amounts can be entered before the HRA method is changed.</span>
          {user?.isAdmin && <Link to="/admin/settings" className="font-semibold underline">Change HRA method</Link>}
        </div>
      )}

      <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-[repeat(3,minmax(0,1fr))_auto] lg:items-end">
        <Select label="Status" placeholder="Any" options={statusOptions} value={status} onChange={(e) => setStatus(e.target.value || 'ALL')} />
        <Field label="As on" type="date" value={asOn} onChange={(e) => setAsOn(e.target.value)} />
        <Field label="Search" placeholder="Search designation" value={search} onChange={(e) => setSearch(e.target.value)} />
        <Button variant={missing.length ? 'secondary' : 'ghost'} className={missing.length ? 'border-warning-500 text-warning-700' : ''} onClick={() => setShowMissing(true)}>
          <AlertTriangle size={16} /> Missing amounts ({missingQ.isLoading ? '…' : missing.length})
        </Button>
      </div>

      {notice && (
        <p role="status" className="mb-3 flex items-start justify-between gap-3 rounded-lg bg-warning-50 px-3 py-2 text-sm text-warning-700">
          <span>{notice}</span>
          <button type="button" className="text-xs font-semibold" onClick={() => setNotice(null)}>Dismiss</button>
        </p>
      )}
      {listQ.isError && <p role="alert" className="mb-3 rounded-lg bg-danger-50 px-3 py-2 text-sm text-danger-700">{errorMessage(listQ.error)}</p>}

      <DataTable data={listQ.data?.items ?? []} columns={columns} loading={listQ.isLoading} empty="No amounts match these filters" />

      {form && (
        <AmountForm
          state={form}
          designations={(designations.data ?? []).filter((d) => d.is_active).map((d) => ({ value: d.id, label: d.designation_name }))}
          onClose={() => setForm(null)}
          onSaved={(warnings) => { setForm(null); refresh(warnings.length ? warnings.join(' ') : undefined); }}
        />
      )}
      {deactivating && <DeactivateDialog row={deactivating} onClose={() => setDeactivating(null)} onDone={() => { setDeactivating(null); refresh(); }} />}

      {showMissing && (
        <Modal open title={`Missing HRA amounts as on ${formatDate(asOn || missingQ.data?.asOn)}`} onClose={() => setShowMissing(false)}>
          {missing.length ? (
            <ul className="divide-y divide-ink-100 rounded-lg border border-ink-200">
              {missing.map((m) => (
                <li key={m.keyId ?? 'none'} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                  <span><b>{m.keyName}</b> <span className="text-ink-500">· {m.employeeCount} employee{m.employeeCount === 1 ? '' : 's'}</span></span>
                  {m.keyId === null ? (
                    <Link to="/hr/branches" className="text-xs font-semibold text-brand-700">Set place on branch</Link>
                  ) : (
                    canEdit && <Button variant="secondary" onClick={() => { setShowMissing(false); setForm({ mode: 'add', designationId: m.keyId! }); }}>Add amount</Button>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <p className="rounded-lg bg-success-50 px-3 py-2 text-sm text-success-700">Every designation with employees has a current amount.</p>
          )}
        </Modal>
      )}
    </>
  );
}

interface FormValues {
  designationId: string;
  gccAmount: string;
  otherAmount: string;
  effectiveFrom: string;
  effectiveTo: string;
  remarks: string;
}

const amountRule = { required: 'Enter an amount', validate: (v: string) => /^\d+$/.test(v.trim()) || 'Enter whole rupees' };
const whole = (v: string) => String(Number(v));

function AmountForm({ state, designations, onClose, onSaved }: {
  state: FormState;
  designations: Option[];
  onClose: () => void;
  onSaved: (warnings: string[]) => void;
}) {
  const { mode, row } = state;
  const detail = useQuery({ queryKey: ['hra-amount', row?.id, row?.updated_at], queryFn: () => payrollApi.hraAmounts.get(row!.id), enabled: !!row });
  const viewOnly = mode === 'view';
  const locked = mode === 'edit' && !!detail.data?.usedInFinalisedPayroll;

  const { register, handleSubmit, setError, formState } = useForm<FormValues>({
    defaultValues: {
      designationId: String(state.designationId ?? ''),
      gccAmount: row ? whole(row.gcc_amount) : '',
      otherAmount: row ? whole(row.other_amount) : '',
      effectiveFrom: mode === 'revise' ? '' : row?.effective_from ?? '',
      effectiveTo: mode === 'revise' ? '' : row?.effective_to ?? '',
      remarks: mode === 'revise' ? '' : row?.remarks ?? '',
    },
  });
  const err = (k: keyof FormValues) => formState.errors[k]?.message;

  const save = useMutation({
    mutationFn: ({ designationId, effectiveTo, ...v }: FormValues) => {
      const body: HraAmountInput = mode === 'revise' ? v : { ...v, effectiveTo };
      if (mode === 'add') return payrollApi.hraAmounts.create({ ...body, designationId });
      return mode === 'revise' ? payrollApi.hraAmounts.revise(row!.id, body) : payrollApi.hraAmounts.update(row!.id, body);
    },
    onSuccess: (r) => onSaved(r.warnings ?? []),
    onError: (e) => {
      const fe = fieldErrors(e);
      if (fe) for (const [f, m] of Object.entries(fe)) setError(f as keyof FormValues, { message: m[0] });
    },
  });

  const title = { add: 'Add HRA amount', edit: 'Edit HRA amount', revise: 'Revise HRA amount', view: 'HRA amount' }[mode];
  return (
    <Modal open title={title} onClose={onClose}>
      <form noValidate className="space-y-4" onSubmit={handleSubmit((v) => save.mutate(v))}>
        {mode === 'add' ? (
          <Select label="Designation *" placeholder="Select designation" options={designations} {...register('designationId', { required: 'Select a designation.' })} error={err('designationId')} />
        ) : (
          <p className="text-sm"><span className="text-ink-500">Designation:</span> <b>{row?.designation_name}</b></p>
        )}
        {mode === 'revise' && row && (
          <p className="rounded-lg bg-brand-25 px-3 py-2 text-sm text-ink-700">
            Current: {formatINR(row.gcc_amount)} in Greater Chennai, {formatINR(row.other_amount)} elsewhere, from {formatDate(row.effective_from)}. It will close the day before the new effective date.
          </p>
        )}
        {locked && (
          <p className="rounded-lg bg-warning-50 px-3 py-2 text-sm text-warning-700">
            This amount has been used in a finalised payroll. Only remarks can be edited; use Revise to change the amount.
          </p>
        )}
        <fieldset disabled={viewOnly || locked} className="grid grid-cols-2 gap-3">
          <Field label="Greater Chennai ₹ *" type="number" step="1" min={0} {...register('gccAmount', amountRule)} error={err('gccAmount')} />
          <Field label="Other places ₹ *" type="number" step="1" min={0} {...register('otherAmount', amountRule)} error={err('otherAmount')} />
          <Field label="Effective from *" type="date" {...register('effectiveFrom', { required: 'Enter a date' })} error={err('effectiveFrom')} />
          {mode !== 'revise' && <Field label="Effective to (optional)" type="date" {...register('effectiveTo')} error={err('effectiveTo')} />}
        </fieldset>
        {!viewOnly && <p className="text-xs text-ink-500">Enter the same amount in both if it does not depend on the place. 0 means no HRA.</p>}
        <TextArea label="Remarks" placeholder="Settlement / G.O. no. …" disabled={viewOnly} {...register('remarks')} error={err('remarks')} />
        {viewOnly && row && (
          <p className="text-xs text-ink-500">Entered by {row.created_by} on {new Date(row.created_at).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}{row.updated_by && <> · last changed by {row.updated_by}</>}</p>
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

function DeactivateDialog({ row, onClose, onDone }: { row: HraAmount; onClose: () => void; onDone: () => void }) {
  const del = useMutation({ mutationFn: () => payrollApi.hraAmounts.deactivate(row.id), onSuccess: onDone });
  return (
    <Modal open title="Deactivate amount?" onClose={onClose}>
      <p className="text-sm text-ink-700">
        The HRA amount for <b>{row.designation_name}</b> from {formatDate(row.effective_from)} will no longer be used. Employees of this designation will show as missing an amount.
      </p>
      {del.isError && <p role="alert" className="mt-3 rounded-lg bg-danger-50 px-3 py-2 text-sm text-danger-700">{errorMessage(del.error)}</p>}
      <div className="mt-5 flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button variant="danger" disabled={del.isPending} onClick={() => del.mutate()}>{del.isPending ? 'Deactivating…' : 'Deactivate'}</Button>
      </div>
    </Modal>
  );
}
