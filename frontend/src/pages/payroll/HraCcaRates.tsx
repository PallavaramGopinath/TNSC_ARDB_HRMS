import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createColumnHelper } from '@tanstack/react-table';
import { AlertTriangle, Ban, Eye, History, Info, ListChecks, Pencil, Plus, RefreshCw } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link } from 'react-router-dom';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { DataTable } from '@/components/ui/DataTable';
import { Field } from '@/components/ui/Field';
import { Modal } from '@/components/ui/Modal';
import { PageHeader } from '@/components/ui/PageHeader';
import { Pagination } from '@/components/ui/Pagination';
import { Select, type Option } from '@/components/ui/Select';
import { TextArea } from '@/components/ui/TextArea';
import { useAuth } from '@/hooks/useAuth';
import { formatDate, formatINR } from '@/lib/format';
import { errorMessage, fieldErrors } from '@/services/api';
import { coreApi } from '@/services/core';
import { hrApi } from '@/services/hr';
import { payrollApi, type HraCcaRateInput } from '@/services/payroll';
import type { HraCcaBasis, HraCcaRate, HraCcaStatus } from '@/types/api';

/**
 * Payroll › Masters › HRA & CCA Rates (specs/01 §5.2–5.5). The screen follows the organisation's
 * calculation basis: rates per place category (PLACE) or per designation (DESIGNATION).
 */
const col = createColumnHelper<HraCcaRate>();
const pct = (v: string | number) => Number(v).toFixed(2);
const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
const keyLabel = (b: HraCcaBasis) => (b === 'PLACE' ? 'Place' : 'Designation');
const basisText = (b: HraCcaBasis) => (b === 'PLACE' ? 'PLACE OF POSTING' : 'DESIGNATION');
const other = (b: HraCcaBasis): HraCcaBasis => (b === 'PLACE' ? 'DESIGNATION' : 'PLACE');

const statusTone: Record<HraCcaStatus, 'success' | 'brand' | 'neutral' | 'danger'> = { CURRENT: 'success', FUTURE: 'brand', EXPIRED: 'neutral', INACTIVE: 'danger' };
const statusOptions: Option[] = [
  { value: 'CURRENT', label: 'Current' },
  { value: 'FUTURE', label: 'Future' },
  { value: 'EXPIRED', label: 'Expired' },
  { value: 'INACTIVE', label: 'Inactive' },
  { value: 'ALL', label: 'All' },
];

/** "min ₹500 · max ₹2,000" or "no cap". */
const caps = (min: string, max: string) => {
  const parts = [Number(min) > 0 ? `min ${formatINR(min)}` : null, Number(max) > 0 ? `max ${formatINR(max)}` : null].filter(Boolean);
  return parts.length ? parts.join(' · ') : 'no cap';
};

type FormMode = 'add' | 'edit' | 'revise' | 'view';
interface FormState { mode: FormMode; row?: HraCcaRate; keyId?: number }

export function HraCcaRatesPage() {
  const qc = useQueryClient();
  const { user } = useAuth();
  const canEdit = !!user && (user.isAdmin || user.roles.includes('Payroll'));

  const [showOtherBasis, setShowOtherBasis] = useState(false);
  const [keyId, setKeyId] = useState('');
  const [status, setStatus] = useState('CURRENT');
  const [asOn, setAsOn] = useState(today());
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [form, setForm] = useState<FormState | null>(null);
  const [deactivating, setDeactivating] = useState<HraCcaRate | null>(null);
  const [showMissing, setShowMissing] = useState(false);
  const [showBulk, setShowBulk] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const basisQ = useQuery({ queryKey: ['hra-cca-basis'], queryFn: payrollApi.hraCcaBasis.status });
  const active = basisQ.data?.basis;
  const shownBasis = active ? (showOtherBasis ? other(active) : active) : undefined;
  const readOnly = !canEdit || showOtherBasis;

  const places = useQuery({ queryKey: ['place-categories'], queryFn: coreApi.placeCategories, staleTime: 10 * 60_000 });
  const designations = useQuery({ queryKey: ['designations', '', false], queryFn: () => hrApi.designations.list(), staleTime: 60_000 });
  const keyOptions = (b?: HraCcaBasis): Option[] =>
    b === 'PLACE'
      ? (places.data ?? []).map((p) => ({ value: p.id, label: `${p.name} (${p.code})` }))
      : (designations.data ?? []).filter((d) => d.is_active).map((d) => ({ value: d.id, label: d.designation_name }));

  useEffect(() => { setPage(1); setKeyId(''); }, [shownBasis]);

  const params = {
    basis: shownBasis,
    placeId: shownBasis === 'PLACE' && keyId ? Number(keyId) : undefined,
    designationId: shownBasis === 'DESIGNATION' && keyId ? Number(keyId) : undefined,
    status,
    asOn: asOn || undefined,
    search: search || undefined,
    page,
    size: 25,
  };
  const listQ = useQuery({ queryKey: ['hra-cca-rates', params], queryFn: () => payrollApi.hraCca.list(params), enabled: !!shownBasis });
  const missingQ = useQuery({ queryKey: ['hra-cca-missing', asOn], queryFn: () => payrollApi.hraCca.missing(asOn || undefined), enabled: !!active });

  const refresh = (msg?: string) => {
    setNotice(msg ?? null);
    void qc.invalidateQueries({ queryKey: ['hra-cca-rates'] });
    void qc.invalidateQueries({ queryKey: ['hra-cca-missing'] });
    void qc.invalidateQueries({ queryKey: ['hra-cca-basis'] });
  };

  const columns = useMemo(
    () => [
      col.accessor('key_name', { header: shownBasis ? keyLabel(shownBasis) : 'Key', cell: (c) => <span className="font-medium">{c.getValue()}</span> }),
      col.accessor('hra_percentage', {
        header: () => <span className="block text-right">HRA %</span>,
        cell: (c) => (
          <span className="block text-right">
            <span className="font-semibold tabular-nums">{pct(c.getValue())}</span>
            <span className="block text-xs text-ink-500">{caps(c.row.original.hra_minimum_amount, c.row.original.hra_maximum_amount)}</span>
          </span>
        ),
      }),
      col.accessor('cca_percentage', {
        header: () => <span className="block text-right">CCA %</span>,
        cell: (c) => (
          <span className="block text-right">
            <span className="font-semibold tabular-nums">{pct(c.getValue())}</span>
            <span className="block text-xs text-ink-500">{caps(c.row.original.cca_minimum_amount, c.row.original.cca_maximum_amount)}</span>
          </span>
        ),
      }),
      col.accessor('effective_from', { header: 'Eff. from', cell: (c) => formatDate(c.getValue()) }),
      col.accessor('effective_to', { header: 'Eff. to', cell: (c) => (c.getValue() ? formatDate(c.getValue()) : <span className="text-ink-500">—</span>) }),
      col.accessor('status', { header: 'Status', cell: (c) => <Badge tone={statusTone[c.getValue()]}>{c.getValue().charAt(0) + c.getValue().slice(1).toLowerCase()}</Badge> }),
      col.accessor('remarks', { header: 'Remarks', cell: (c) => <span className="block max-w-[16rem] truncate text-ink-600" title={c.getValue() ?? ''}>{c.getValue() ?? '—'}</span> }),
      col.display({
        id: 'actions',
        header: '',
        cell: (c) => {
          const r = c.row.original;
          const editable = !readOnly && r.is_active && (r.status === 'CURRENT' || r.status === 'FUTURE');
          return (
            <div className="flex justify-end gap-1">
              {editable ? (
                <>
                  <Button variant="ghost" title="Edit" aria-label={`Edit rate for ${r.key_name}`} onClick={() => setForm({ mode: 'edit', row: r })}><Pencil size={14} /></Button>
                  <Button variant="ghost" title="Revise" aria-label={`Revise rate for ${r.key_name}`} onClick={() => setForm({ mode: 'revise', row: r })}><RefreshCw size={14} /></Button>
                  <Button variant="ghost" title="Deactivate" aria-label={`Deactivate rate for ${r.key_name}`} onClick={() => setDeactivating(r)}><Ban size={14} /></Button>
                </>
              ) : (
                <Button variant="ghost" title="View" aria-label={`View rate for ${r.key_name}`} onClick={() => setForm({ mode: 'view', row: r })}><Eye size={14} /></Button>
              )}
            </div>
          );
        },
      }),
    ],
    [shownBasis, readOnly],
  );

  const missingCount = missingQ.data?.missing.length ?? 0;

  return (
    <>
      <PageHeader
        title="HRA & CCA Rates"
        subtitle="House Rent and City Compensatory Allowance as a % of Basic + Grade Pay + Special Pay, with optional minimum and maximum"
        actions={
          canEdit && active && !showOtherBasis ? (
            <>
              <Button variant="secondary" onClick={() => setShowBulk(true)}><ListChecks size={16} /> Revise all</Button>
              <Button onClick={() => setForm({ mode: 'add' })}><Plus size={16} /> Add rate</Button>
            </>
          ) : undefined
        }
      />

      {active && (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-brand-100 bg-brand-25 px-4 py-3 text-sm text-ink-800">
          <span className="flex items-center gap-2">
            <Info size={16} className="text-brand-600" />
            Rates are applied by <b>{basisText(active)}</b> for this organisation
            {basisQ.data && basisQ.data.todayBasis !== active && <> from {formatDate(basisQ.data.effectiveFrom)} (until then by {basisText(basisQ.data.todayBasis)})</>}.
          </span>
          {user?.isAdmin && <Link to="/admin/settings" className="font-semibold text-brand-700 hover:underline">Change basis</Link>}
        </div>
      )}

      {showOtherBasis && shownBasis && (
        <p className="mb-4 flex items-center gap-2 rounded-lg bg-warning-50 px-4 py-2 text-sm text-warning-700">
          <History size={16} /> Showing {basisText(shownBasis).toLowerCase()} rates of the inactive basis. They are kept for history and are not used by payroll.
        </p>
      )}

      <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-[repeat(4,minmax(0,1fr))_auto] lg:items-end">
        <Select label={shownBasis ? keyLabel(shownBasis) : 'Key'} placeholder="All" options={keyOptions(shownBasis)} value={keyId} onChange={(e) => { setKeyId(e.target.value); setPage(1); }} />
        <Select label="Status" placeholder="Any" options={statusOptions} value={status} onChange={(e) => { setStatus(e.target.value || 'ALL'); setPage(1); }} />
        <Field label="As on" type="date" value={asOn} onChange={(e) => { setAsOn(e.target.value); setPage(1); }} />
        <Field label="Search" placeholder={`Search ${shownBasis ? keyLabel(shownBasis).toLowerCase() : ''}`} value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} />
        <Button variant={missingCount ? 'secondary' : 'ghost'} className={missingCount ? 'border-warning-500 text-warning-700' : ''} onClick={() => setShowMissing(true)} disabled={!active}>
          <AlertTriangle size={16} /> Missing rates ({missingQ.isLoading ? '…' : missingCount})
        </Button>
      </div>
      <label className="mb-3 flex items-center gap-2 text-sm text-ink-600">
        <input type="checkbox" className="accent-brand-600" checked={showOtherBasis} onChange={(e) => setShowOtherBasis(e.target.checked)} /> Show rates of inactive basis
        {active && <span className="text-ink-400">({basisQ.data?.rateCounts[other(active)] ?? 0} {keyLabel(other(active)).toLowerCase()} rates)</span>}
      </label>

      {notice && (
        <p role="status" className="mb-3 flex items-start justify-between gap-3 rounded-lg bg-warning-50 px-3 py-2 text-sm text-warning-700">
          <span>{notice}</span>
          <button type="button" className="text-xs font-semibold" onClick={() => setNotice(null)}>Dismiss</button>
        </p>
      )}

      <DataTable data={listQ.data?.items ?? []} columns={columns} loading={basisQ.isLoading || listQ.isLoading} empty="No rates match these filters" />
      <Pagination page={page} pageSize={25} total={listQ.data?.total ?? 0} onPage={setPage} />

      {form && shownBasis && (
        <RateForm
          state={form}
          basis={form.row?.rate_basis ?? shownBasis}
          keyOptions={keyOptions(form.row?.rate_basis ?? shownBasis)}
          onClose={() => setForm(null)}
          onSaved={(warnings) => { setForm(null); refresh(warnings.length ? warnings.join(' ') : undefined); }}
        />
      )}

      {deactivating && (
        <DeactivateDialog row={deactivating} onClose={() => setDeactivating(null)} onDone={() => { setDeactivating(null); refresh(); }} />
      )}

      {showMissing && active && (
        <Modal open title={`Missing rates as on ${formatDate(asOn)}`} onClose={() => setShowMissing(false)}>
          <p className="mb-3 text-sm text-ink-600">
            {keyLabel(active)}s with serving employees but no current rate. Payroll will flag these employees until a rate is added.
          </p>
          {missingQ.data?.missing.length ? (
            <ul className="divide-y divide-ink-100 rounded-lg border border-ink-200">
              {missingQ.data.missing.map((m) => (
                <li key={m.keyId ?? 'none'} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                  <span><b>{m.keyName}</b> <span className="text-ink-500">· {m.employeeCount} employee{m.employeeCount === 1 ? '' : 's'}</span></span>
                  {canEdit && m.keyId !== null && (
                    <Button variant="secondary" onClick={() => { setShowMissing(false); setShowOtherBasis(false); setForm({ mode: 'add', keyId: m.keyId! }); }}>Add rate</Button>
                  )}
                  {m.keyId === null && <Link to="/hr/branches" className="text-xs font-semibold text-brand-700">Set place on branch</Link>}
                </li>
              ))}
            </ul>
          ) : (
            <p className="rounded-lg bg-success-50 px-3 py-2 text-sm text-success-700">Every {keyLabel(active).toLowerCase()} with employees has a current rate.</p>
          )}
        </Modal>
      )}

      {showBulk && active && (
        <BulkReviseDialog basis={active} onClose={() => setShowBulk(false)} onSaved={(msg) => { setShowBulk(false); refresh(msg); }} />
      )}
    </>
  );
}

// ---------------------------------------------------------------- add / edit / revise / view
interface FormValues {
  keyId: string;
  hraPercent: string;
  hraMinAmount: string;
  hraMaxAmount: string;
  ccaPercent: string;
  ccaMinAmount: string;
  ccaMaxAmount: string;
  effectiveFrom: string;
  effectiveTo: string;
  remarks: string;
}

const pctRule = { required: 'Enter a value between 0 and 100.', min: { value: 0, message: 'Enter a value between 0 and 100.' }, max: { value: 100, message: 'Enter a value between 0 and 100.' } };

function RateForm({ state, basis, keyOptions, onClose, onSaved }: {
  state: FormState;
  basis: HraCcaBasis;
  keyOptions: Option[];
  onClose: () => void;
  onSaved: (warnings: string[]) => void;
}) {
  const { mode, row } = state;
  const detail = useQuery({ queryKey: ['hra-cca-rate', row?.id], queryFn: () => payrollApi.hraCca.get(row!.id), enabled: !!row });
  const locked = mode === 'edit' && !!detail.data?.usedInFinalisedPayroll;
  const viewOnly = mode === 'view';

  const { register, handleSubmit, watch, setError, formState } = useForm<FormValues>({
    defaultValues: {
      keyId: String(state.keyId ?? (row ? (basis === 'PLACE' ? row.place_id : row.designation_id) : '') ?? ''),
      hraPercent: row ? pct(row.hra_percentage) : '',
      hraMinAmount: row ? row.hra_minimum_amount : '0',
      hraMaxAmount: row ? row.hra_maximum_amount : '0',
      ccaPercent: row ? pct(row.cca_percentage) : '',
      ccaMinAmount: row ? row.cca_minimum_amount : '0',
      ccaMaxAmount: row ? row.cca_maximum_amount : '0',
      effectiveFrom: mode === 'revise' ? '' : row?.effective_from ?? '',
      effectiveTo: mode === 'revise' ? '' : row?.effective_to ?? '',
      remarks: mode === 'revise' ? '' : row?.remarks ?? '',
    },
  });

  const keyId = watch('keyId');
  const affected = useQuery({
    queryKey: ['hra-cca-affected', basis, keyId],
    queryFn: () => payrollApi.hraCca.affected(basis === 'PLACE' ? { placeId: Number(keyId) } : { designationId: Number(keyId) }),
    enabled: !!keyId,
  });

  const save = useMutation({
    mutationFn: (v: FormValues) => {
      const body: HraCcaRateInput = {
        hraPercent: v.hraPercent, hraMinAmount: v.hraMinAmount, hraMaxAmount: v.hraMaxAmount,
        ccaPercent: v.ccaPercent, ccaMinAmount: v.ccaMinAmount, ccaMaxAmount: v.ccaMaxAmount,
        effectiveFrom: v.effectiveFrom, effectiveTo: v.effectiveTo, remarks: v.remarks,
      };
      if (mode === 'add') return payrollApi.hraCca.create({ ...body, ...(basis === 'PLACE' ? { placeId: Number(v.keyId) } : { designationId: Number(v.keyId) }) });
      if (mode === 'revise') return payrollApi.hraCca.revise(row!.id, body);
      return payrollApi.hraCca.update(row!.id, body);
    },
    onSuccess: (r) => onSaved(r.warnings ?? []),
    onError: (e) => {
      const fe = fieldErrors(e);
      if (fe)
        for (const [f, m] of Object.entries(fe)) {
          const field = (f === 'placeId' || f === 'designationId' ? 'keyId' : f) as keyof FormValues;
          setError(field, { message: m[0] });
        }
    },
  });

  const title = { add: 'Add HRA & CCA rate', edit: 'Edit HRA & CCA rate', revise: 'Revise HRA & CCA rate', view: 'HRA & CCA rate' }[mode];
  const ro = viewOnly || locked;
  const err = (k: keyof FormValues) => formState.errors[k]?.message;

  return (
    <Modal open title={title} onClose={onClose}>
      <form noValidate className="space-y-4" onSubmit={handleSubmit((v) => save.mutate(v))}>
        <dl className="grid grid-cols-2 gap-2 text-sm">
          <dt className="text-ink-500">Basis</dt>
          <dd className="font-medium">{keyLabel(basis)} (read-only)</dd>
        </dl>
        {mode === 'add' ? (
          <Select label={`${keyLabel(basis)} *`} placeholder={`Select ${keyLabel(basis).toLowerCase()}`} options={keyOptions} {...register('keyId', { required: `Select a ${keyLabel(basis).toLowerCase()}.` })} error={err('keyId')} />
        ) : (
          <p className="text-sm"><span className="text-ink-500">{keyLabel(basis)}:</span> <b>{row?.key_name}</b></p>
        )}
        {mode === 'revise' && row && (
          <p className="rounded-lg bg-brand-25 px-3 py-2 text-sm text-ink-700">
            Current: HRA {pct(row.hra_percentage)}%, CCA {pct(row.cca_percentage)}% from {formatDate(row.effective_from)}. It will close the day before the new effective date.
          </p>
        )}
        {locked && (
          <p className="rounded-lg bg-warning-50 px-3 py-2 text-sm text-warning-700">
            This rate has been used in a finalised payroll. Only remarks can be edited; use Revise to change the rate.
          </p>
        )}
        <fieldset disabled={ro} className="space-y-4">
          <div className="grid grid-cols-3 gap-3">
            <Field label="HRA % *" type="number" step="0.01" min={0} max={100} {...register('hraPercent', pctRule)} error={err('hraPercent')} />
            <Field label="HRA min ₹" type="number" step="0.01" min={0} {...register('hraMinAmount')} error={err('hraMinAmount')} />
            <Field label="HRA max ₹ (0 = no cap)" type="number" step="0.01" min={0} {...register('hraMaxAmount')} error={err('hraMaxAmount')} />
            <Field label="CCA % *" type="number" step="0.01" min={0} max={100} {...register('ccaPercent', pctRule)} error={err('ccaPercent')} />
            <Field label="CCA min ₹" type="number" step="0.01" min={0} {...register('ccaMinAmount')} error={err('ccaMinAmount')} />
            <Field label="CCA max ₹ (0 = no cap)" type="number" step="0.01" min={0} {...register('ccaMaxAmount')} error={err('ccaMaxAmount')} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Effective from *" type="date" {...register('effectiveFrom', { required: 'Enter a date' })} error={err('effectiveFrom')} />
            {mode !== 'revise' && <Field label="Effective to (blank = till revised)" type="date" {...register('effectiveTo')} error={err('effectiveTo')} />}
          </div>
        </fieldset>
        <TextArea label="Remarks" placeholder="G.O. / circular no. …" disabled={viewOnly} {...register('remarks')} error={err('remarks')} />
        {keyId && !viewOnly && (
          <p className="text-sm text-ink-600">Employees affected now: <b>{affected.isLoading ? '…' : affected.data?.count ?? 0}</b></p>
        )}
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

function DeactivateDialog({ row, onClose, onDone }: { row: HraCcaRate; onClose: () => void; onDone: () => void }) {
  const del = useMutation({ mutationFn: () => payrollApi.hraCca.deactivate(row.id), onSuccess: onDone });
  return (
    <Modal open title="Deactivate rate?" onClose={onClose}>
      <p className="text-sm text-ink-700">
        HRA {pct(row.hra_percentage)}% / CCA {pct(row.cca_percentage)}% for <b>{row.key_name}</b> from {formatDate(row.effective_from)} will no longer be used.
        Employees mapped to it will show as missing a rate.
      </p>
      {del.isError && <p role="alert" className="mt-3 rounded-lg bg-danger-50 px-3 py-2 text-sm text-danger-700">{errorMessage(del.error)}</p>}
      <div className="mt-5 flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button variant="danger" disabled={del.isPending} onClick={() => del.mutate()}>{del.isPending ? 'Deactivating…' : 'Deactivate'}</Button>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------- bulk revision (spec §5.5)
function BulkReviseDialog({ basis, onClose, onSaved }: { basis: HraCcaBasis; onClose: () => void; onSaved: (msg?: string) => void }) {
  const [effectiveFrom, setEffectiveFrom] = useState('');
  const [remarks, setRemarks] = useState('');
  const [edits, setEdits] = useState<Record<number, { hra: string; cca: string }>>({});
  const current = useQuery({
    queryKey: ['hra-cca-rates', 'bulk', basis],
    queryFn: () => payrollApi.hraCca.list({ basis, status: 'CURRENT', size: 200 }),
  });
  const rows = current.data?.items ?? [];
  const keyOf = (r: HraCcaRate) => (basis === 'PLACE' ? r.place_id : r.designation_id)!;
  const value = (r: HraCcaRate) => edits[r.id] ?? { hra: pct(r.hra_percentage), cca: pct(r.cca_percentage) };
  const changed = rows.filter((r) => {
    const v = value(r);
    return Number(v.hra) !== Number(r.hra_percentage) || Number(v.cca) !== Number(r.cca_percentage);
  });

  const save = useMutation({
    mutationFn: () =>
      payrollApi.hraCca.bulkRevise({
        effectiveFrom,
        remarks: remarks || undefined,
        items: changed.map((r) => ({
          keyId: keyOf(r),
          hraPercent: value(r).hra,
          ccaPercent: value(r).cca,
          hraMinAmount: r.hra_minimum_amount,
          hraMaxAmount: r.hra_maximum_amount,
          ccaMinAmount: r.cca_minimum_amount,
          ccaMaxAmount: r.cca_maximum_amount,
        })),
      }),
    onSuccess: (r) => onSaved([`${r.count} rate${r.count === 1 ? '' : 's'} revised from ${formatDate(effectiveFrom)}.`, ...r.warnings].join(' ')),
  });

  return (
    <Modal open title="Revise all rates" onClose={onClose}>
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <Field label="New effective from *" type="date" value={effectiveFrom} onChange={(e) => setEffectiveFrom(e.target.value)} />
          <Field label="Remarks" placeholder="G.O. / circular no." value={remarks} onChange={(e) => setRemarks(e.target.value)} />
        </div>
        <div className="max-h-[45vh] overflow-y-auto rounded-lg border border-ink-200">
          <table className="min-w-full text-sm">
            <thead className="sticky top-0 bg-ink-50 text-left text-xs font-semibold uppercase text-ink-500">
              <tr><th className="px-3 py-2">{keyLabel(basis)}</th><th className="px-3 py-2">HRA %</th><th className="px-3 py-2">CCA %</th></tr>
            </thead>
            <tbody className="divide-y divide-ink-100">
              {current.isLoading && <tr><td colSpan={3} className="px-3 py-4 text-center text-ink-400">Loading…</td></tr>}
              {!current.isLoading && rows.length === 0 && <tr><td colSpan={3} className="px-3 py-4 text-center text-ink-400">No current rates to revise</td></tr>}
              {rows.map((r) => {
                const v = value(r);
                const set = (k: 'hra' | 'cca', x: string) => setEdits((e) => ({ ...e, [r.id]: { ...v, [k]: x } }));
                return (
                  <tr key={r.id}>
                    <td className="px-3 py-1.5 font-medium">{r.key_name}</td>
                    <td className="px-3 py-1.5"><input aria-label={`HRA % for ${r.key_name}`} className="field-input w-24" type="number" step="0.01" min={0} max={100} value={v.hra} onChange={(e) => set('hra', e.target.value)} /></td>
                    <td className="px-3 py-1.5"><input aria-label={`CCA % for ${r.key_name}`} className="field-input w-24" type="number" step="0.01" min={0} max={100} value={v.cca} onChange={(e) => set('cca', e.target.value)} /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-ink-500">Minimum and maximum amounts carry over. Each changed row gets a new rate from the date; the old one closes the day before.</p>
        {save.isError && <p role="alert" className="rounded-lg bg-danger-50 px-3 py-2 text-sm text-danger-700">{errorMessage(save.error)}</p>}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button disabled={!effectiveFrom || changed.length === 0 || save.isPending} onClick={() => save.mutate()}>
            {save.isPending ? 'Saving…' : `Save ${changed.length} change${changed.length === 1 ? '' : 's'}`}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
