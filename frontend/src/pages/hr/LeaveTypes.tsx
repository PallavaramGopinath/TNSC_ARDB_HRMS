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
import { errorMessage, fieldErrors } from '@/services/api';
import { hrApi, type LeaveTypeInput } from '@/services/hr';
import type { LeaveType } from '@/types/api';

const col = createColumnHelper<LeaveType>();

/** Pay-cut factor → how pay is treated on a day of this leave. */
export function payLabel(f: string | number): { text: string; tone: 'success' | 'warning' | 'danger' } {
  const n = Number(f);
  if (n === 0) return { text: 'Full pay', tone: 'success' };
  if (n === 1) return { text: 'No pay', tone: 'danger' };
  if (n === 0.5) return { text: 'Half pay', tone: 'warning' };
  return { text: `${Math.round((1 - n) * 100)}% pay`, tone: 'warning' };
}

const Tick = ({ on }: { on: boolean }) => (on ? <Check size={16} className="text-success-600" aria-label="Yes" /> : <span className="text-ink-300" aria-label="No">—</span>);

/** Leave Types master (TNCU /hr/leave-types). CL, EL, ML and LOP are system types the leave and payroll logic depend on. */
export function LeaveTypesPage() {
  const qc = useQueryClient();
  const { user } = useAuth();
  const canEdit = !!user && (user.isAdmin || user.roles.includes('HR'));
  const [showInactive, setShowInactive] = useState(false);
  const [editing, setEditing] = useState<LeaveType | 'new' | null>(null);
  const [deleting, setDeleting] = useState<LeaveType | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const { data = [], isLoading } = useQuery({
    queryKey: ['leave-types', showInactive],
    queryFn: () => hrApi.leaveTypes.list({ includeInactive: showInactive }),
  });
  const refresh = () => qc.invalidateQueries({ queryKey: ['leave-types'] });

  const toggle = useMutation({
    mutationFn: (t: LeaveType) => hrApi.leaveTypes.setActive(t.id, !t.is_active),
    onSuccess: () => { setActionError(null); void refresh(); },
    onError: (e) => setActionError(errorMessage(e)),
  });

  const columns = useMemo(
    () => [
      col.accessor('leave_code', {
        header: 'Code',
        cell: (c) => (
          <span className="inline-flex items-center gap-1.5">
            <code className="rounded bg-ink-100 px-1.5 py-0.5 text-xs font-semibold">{c.getValue()}</code>
            {c.row.original.is_system && <span title="System leave type — used by leave credit and payroll rules"><Lock size={12} className="text-ink-400" /></span>}
          </span>
        ),
      }),
      col.accessor('leave_name', { header: 'Leave name' }),
      col.accessor('annual_quota', { header: 'Quota / yr', cell: (c) => <span className="tabular-nums">{Number(c.getValue())}</span> }),
      col.accessor('pay_cut_factor', { header: 'Pay on leave', cell: (c) => { const p = payLabel(c.getValue()); return <Badge tone={p.tone}>{p.text}</Badge>; } }),
      col.accessor('carry_forward', { header: 'Carry fwd', cell: (c) => <Tick on={c.getValue()} /> }),
      col.accessor('encashment_allowed', { header: 'Encash', cell: (c) => <Tick on={c.getValue()} /> }),
      col.accessor('cuts_special_pay_and_da', { header: 'Cuts SP & DA', cell: (c) => <Tick on={c.getValue()} /> }),
      col.accessor('affects_leave_balance', { header: 'Debits balance', cell: (c) => <Tick on={c.getValue()} /> }),
      col.accessor('usage_count', { header: 'In use', cell: (c) => <span className="tabular-nums">{c.getValue()}</span> }),
      col.accessor('is_active', { header: 'Status', cell: (c) => (c.getValue() ? <Badge tone="success">Active</Badge> : <Badge>Inactive</Badge>) }),
      col.display({
        id: 'actions',
        header: '',
        cell: ({ row: { original: t } }) => {
          if (!canEdit) return null;
          const deleteBlock = t.is_system ? 'System leave type — cannot be deleted' : t.usage_count > 0 ? 'In use — deactivate instead' : null;
          const toggleBlock = t.is_system && t.is_active ? 'System leave type — cannot be deactivated' : null;
          return (
            <div className="flex justify-end gap-1">
              <Button variant="ghost" aria-label={`Edit ${t.leave_name}`} title="Edit" onClick={() => setEditing(t)}><Pencil size={14} /></Button>
              <Button variant="ghost" aria-label={`${t.is_active ? 'Deactivate' : 'Activate'} ${t.leave_name}`} title={toggleBlock ?? (t.is_active ? 'Deactivate' : 'Activate')} disabled={!!toggleBlock} onClick={() => toggle.mutate(t)}>
                <Power size={14} className={toggleBlock ? 'text-ink-300' : t.is_active ? 'text-ink-500' : 'text-success-600'} />
              </Button>
              <Button variant="ghost" aria-label={`Delete ${t.leave_name}`} title={deleteBlock ?? 'Delete permanently'} disabled={!!deleteBlock} onClick={() => setDeleting(t)}>
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
        title="Leave Types"
        subtitle="Quotas and how each leave affects pay and the leave balance · locked codes are system types"
        actions={canEdit && <Button onClick={() => setEditing('new')}><Plus size={16} /> New leave type</Button>}
      />
      <label className="mb-4 flex items-center gap-2 text-sm text-ink-600">
        <input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} className="accent-brand-600" /> Show inactive
      </label>
      {actionError && <p role="alert" className="mb-3 rounded-lg bg-danger-50 px-3 py-2 text-sm text-danger-700">{actionError}</p>}
      <DataTable data={data} columns={columns} loading={isLoading} empty="No leave types" />

      {editing && <LeaveTypeForm initial={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); void refresh(); }} />}
      {deleting && <ConfirmDelete type={deleting} onClose={() => setDeleting(null)} onDeleted={() => { setDeleting(null); void refresh(); }} />}
    </>
  );
}

const PAY_PRESETS = [
  { value: '0', label: 'Full pay (no cut)' },
  { value: '0.5', label: 'Half pay (50% cut)' },
  { value: '1', label: 'No pay (100% cut)' },
  { value: 'custom', label: 'Custom…' },
];

const FLAGS: Array<{ name: keyof LeaveTypeInput; label: string; help: string }> = [
  { name: 'affectsLeaveBalance', label: 'Debits the leave balance', help: 'Approved days are deducted from the employee’s balance (off for LOP).' },
  { name: 'carryForward', label: 'Carry forward', help: 'Unused balance rolls into the next financial year.' },
  { name: 'encashmentAllowed', label: 'Encashment allowed', help: 'Can be surrendered for salary (SLS) or encashed at retirement.' },
  { name: 'cutsSpecialPayAndDa', label: 'Also cuts Special Pay & DA', help: 'Payroll prorates SP and DA for these days, not only Basic/GP/PP.' },
];

type FormValues = Omit<LeaveTypeInput, 'annualQuota' | 'payCutFactor'> & { annualQuota: string; payPreset: string; payCutFactor: string };

function LeaveTypeForm({ initial, onClose, onSaved }: { initial: LeaveType | null; onClose: () => void; onSaved: () => void }) {
  const system = !!initial?.is_system;
  const initFactor = initial ? String(Number(initial.pay_cut_factor)) : '0';
  const { register, handleSubmit, setError, watch, formState } = useForm<FormValues>({
    defaultValues: {
      leaveName: initial?.leave_name ?? '',
      leaveCode: initial?.leave_code ?? '',
      annualQuota: initial ? String(Number(initial.annual_quota)) : '0',
      payPreset: ['0', '0.5', '1'].includes(initFactor) ? initFactor : 'custom',
      payCutFactor: initFactor,
      carryForward: initial?.carry_forward ?? false,
      encashmentAllowed: initial?.encashment_allowed ?? false,
      cutsSpecialPayAndDa: initial?.cuts_special_pay_and_da ?? false,
      affectsLeaveBalance: initial?.affects_leave_balance ?? true,
      isActive: initial?.is_active ?? true,
    },
  });
  const preset = watch('payPreset');
  const [err, setErr] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: ({ payPreset, ...v }: FormValues) => {
      const body: LeaveTypeInput = { ...v, leaveCode: v.leaveCode.trim().toUpperCase(), payCutFactor: payPreset === 'custom' ? v.payCutFactor : payPreset };
      return initial ? hrApi.leaveTypes.update(initial.id, body) : hrApi.leaveTypes.create(body);
    },
    onSuccess: onSaved,
    onError: (e) => {
      const fe = fieldErrors(e);
      if (fe) for (const [f, m] of Object.entries(fe)) setError(f as keyof FormValues, { message: m[0] });
      else setErr(errorMessage(e));
    },
  });

  return (
    <Modal open title={initial ? `Edit ${initial.leave_code}` : 'New leave type'} onClose={onClose}>
      <form onSubmit={handleSubmit((v) => { setErr(null); save.mutate(v); })} className="space-y-4" noValidate>
        <div className="grid grid-cols-3 gap-3">
          <div>
            <Field
              label="Code"
              maxLength={20}
              className="field-input font-mono uppercase"
              readOnly={system}
              placeholder="e.g. SCL"
              {...register('leaveCode', { required: 'Leave code is required', pattern: { value: /^[A-Za-z0-9_]{1,20}$/, message: 'Letters, digits or _' } })}
              error={formState.errors.leaveCode?.message}
            />
            {system && !formState.errors.leaveCode && <p className="mt-1 text-xs text-ink-500">System code — locked</p>}
          </div>
          <div className="col-span-2">
            <Field label="Leave name" autoFocus maxLength={100} {...register('leaveName', { required: 'Leave name is required', validate: (v) => v.trim() !== '' || 'Leave name is required' })} error={formState.errors.leaveName?.message} />
          </div>
        </div>
        <div className="grid grid-cols-3 gap-3">
          <Field label="Annual quota (days)" type="number" min={0} max={365} step="0.5" {...register('annualQuota', { required: 'Required', min: { value: 0, message: '0–365' }, max: { value: 365, message: '0–365' } })} error={formState.errors.annualQuota?.message} />
          <div className={preset === 'custom' ? '' : 'col-span-2'}>
            <label htmlFor="payPreset" className="field-label">Pay on leave days</label>
            <select id="payPreset" className="field-input" {...register('payPreset')}>
              {PAY_PRESETS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
            </select>
          </div>
          {preset === 'custom' && (
            <Field label="Pay-cut factor (0–1)" type="number" min={0} max={1} step="0.01" {...register('payCutFactor', { min: { value: 0, message: '0–1' }, max: { value: 1, message: '0–1' } })} error={formState.errors.payCutFactor?.message} />
          )}
        </div>
        <fieldset className="space-y-2 rounded-lg border border-ink-200 p-3">
          <legend className="px-1 text-xs font-semibold uppercase tracking-wide text-ink-500">Rules</legend>
          {FLAGS.map((f) => (
            <label key={f.name} className="flex items-start gap-2 text-sm">
              <input type="checkbox" className="mt-0.5 accent-brand-600" {...register(f.name as keyof FormValues)} />
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

function ConfirmDelete({ type, onClose, onDeleted }: { type: LeaveType; onClose: () => void; onDeleted: () => void }) {
  const del = useMutation({ mutationFn: () => hrApi.leaveTypes.remove(type.id), onSuccess: onDeleted });
  return (
    <Modal open title="Delete leave type permanently?" onClose={onClose}>
      <p className="text-sm text-ink-700"><b>{type.leave_name}</b> ({type.leave_code}) will be removed. This cannot be undone.</p>
      {del.isError && <p role="alert" className="mt-3 rounded-lg bg-danger-50 px-3 py-2 text-sm text-danger-700">{errorMessage(del.error)}</p>}
      <div className="mt-5 flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button variant="danger" disabled={del.isPending} onClick={() => del.mutate()}>{del.isPending ? 'Deleting…' : 'Delete'}</Button>
      </div>
    </Modal>
  );
}
