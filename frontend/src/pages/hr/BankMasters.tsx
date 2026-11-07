import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createColumnHelper } from '@tanstack/react-table';
import { Pencil, Plus, Power, Trash2 } from 'lucide-react';
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
import { hrApi, type BankInput } from '@/services/hr';
import type { BankMaster } from '@/types/api';

const col = createColumnHelper<BankMaster>();

/**
 * Bank Master (TNCU /hr/bank-masters). The IFSC prefix is the first 4 letters of every IFSC at that bank;
 * employee IFSC codes are checked against it. In-use banks can be deactivated but not deleted.
 */
export function BankMastersPage() {
  const qc = useQueryClient();
  const { user } = useAuth();
  const canEdit = !!user && (user.isAdmin || user.roles.includes('HR'));
  const [search, setSearch] = useState('');
  const [showInactive, setShowInactive] = useState(false);
  const [editing, setEditing] = useState<BankMaster | 'new' | null>(null);
  const [deleting, setDeleting] = useState<BankMaster | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const { data = [], isLoading } = useQuery({
    queryKey: ['bank-masters', 'admin', search, showInactive],
    queryFn: () => hrApi.bankMasters.list({ search: search || undefined, includeInactive: showInactive }),
  });
  const refresh = () => qc.invalidateQueries({ queryKey: ['bank-masters'] });

  const toggle = useMutation({
    mutationFn: (b: BankMaster) => hrApi.bankMasters.setActive(b.id, !b.is_active),
    onSuccess: () => { setActionError(null); void refresh(); },
    onError: (e) => setActionError(errorMessage(e)),
  });

  const columns = useMemo(
    () => [
      col.accessor('bank_name', { header: 'Bank name' }),
      col.accessor('ifsc_for_bank', { header: 'IFSC prefix', cell: (c) => <code className="rounded bg-ink-100 px-1.5 py-0.5 text-xs font-semibold">{c.getValue()}</code> }),
      col.accessor('employee_count', { header: 'Employees', cell: (c) => <span className="tabular-nums">{c.getValue()}</span> }),
      col.accessor('is_active', { header: 'Status', cell: (c) => (c.getValue() ? <Badge tone="success">Active</Badge> : <Badge>Inactive</Badge>) }),
      col.display({
        id: 'actions',
        header: '',
        cell: ({ row: { original: b } }) =>
          canEdit && (
            <div className="flex justify-end gap-1">
              <Button variant="ghost" aria-label={`Edit ${b.bank_name}`} title="Edit" onClick={() => setEditing(b)}><Pencil size={14} /></Button>
              <Button variant="ghost" aria-label={`${b.is_active ? 'Deactivate' : 'Activate'} ${b.bank_name}`} title={b.is_active ? 'Deactivate' : 'Activate'} onClick={() => toggle.mutate(b)}>
                <Power size={14} className={b.is_active ? 'text-ink-500' : 'text-success-600'} />
              </Button>
              <Button
                variant="ghost"
                aria-label={`Delete ${b.bank_name}`}
                title={b.employee_count > 0 ? 'In use by employees — deactivate instead' : 'Delete permanently'}
                disabled={b.employee_count > 0}
                onClick={() => setDeleting(b)}
              >
                <Trash2 size={14} className={b.employee_count > 0 ? 'text-ink-300' : 'text-danger-600'} />
              </Button>
            </div>
          ),
      }),
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [canEdit],
  );

  return (
    <>
      <PageHeader
        title="Bank Masters"
        subtitle="Banks for salary credit · the IFSC prefix is the first 4 letters of every IFSC at that bank"
        actions={canEdit && <Button onClick={() => setEditing('new')}><Plus size={16} /> New bank</Button>}
      />
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <input className="field-input max-w-xs" placeholder="Search name or prefix" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search banks" />
        <label className="flex items-center gap-2 text-sm text-ink-600">
          <input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} className="accent-brand-600" /> Show inactive
        </label>
      </div>
      {actionError && <p role="alert" className="mb-3 rounded-lg bg-danger-50 px-3 py-2 text-sm text-danger-700">{actionError}</p>}
      <DataTable data={data} columns={columns} loading={isLoading} empty="No banks yet — add the banks your staff are paid through" />

      {editing && (
        <BankForm
          initial={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); void refresh(); }}
        />
      )}
      {deleting && (
        <ConfirmDelete
          bank={deleting}
          onClose={() => setDeleting(null)}
          onDeleted={() => { setDeleting(null); void refresh(); }}
        />
      )}
    </>
  );
}

function BankForm({ initial, onClose, onSaved }: { initial: BankMaster | null; onClose: () => void; onSaved: () => void }) {
  const inUse = (initial?.employee_count ?? 0) > 0;
  const { register, handleSubmit, setError, formState } = useForm<BankInput>({
    defaultValues: { bankName: initial?.bank_name ?? '', ifscForBank: initial?.ifsc_for_bank ?? '', isActive: initial?.is_active ?? true },
  });
  const [err, setErr] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: (v: BankInput) => {
      const body = { ...v, bankName: v.bankName.trim(), ifscForBank: v.ifscForBank.trim().toUpperCase() };
      return initial ? hrApi.bankMasters.update(initial.id, body) : hrApi.bankMasters.create(body);
    },
    onSuccess: onSaved,
    onError: (e) => {
      const fe = fieldErrors(e);
      if (fe) for (const [f, m] of Object.entries(fe)) setError(f as keyof BankInput, { message: m[0] });
      else setErr(errorMessage(e));
    },
  });

  return (
    <Modal open title={initial ? 'Edit bank' : 'New bank'} onClose={onClose}>
      <form onSubmit={handleSubmit((v) => { setErr(null); save.mutate(v); })} className="space-y-4" noValidate>
        <Field
          label="Bank name"
          autoFocus
          maxLength={150}
          placeholder="e.g. State Bank of India"
          {...register('bankName', { required: 'Bank name is required', validate: (v) => v.trim().length > 0 || 'Bank name is required' })}
          error={formState.errors.bankName?.message}
        />
        <div>
          <Field
            label="IFSC prefix"
            maxLength={4}
            placeholder="e.g. SBIN"
            className="field-input font-mono uppercase"
            readOnly={inUse}
            {...register('ifscForBank', { required: 'IFSC prefix is required', pattern: { value: /^[A-Za-z]{4}$/, message: 'Exactly 4 letters, e.g. SBIN' } })}
            error={formState.errors.ifscForBank?.message}
          />
          {!formState.errors.ifscForBank && (
            <p className="mt-1 text-xs text-ink-500">
              {inUse ? `Locked — ${initial!.employee_count} employee(s) have IFSC codes with this prefix.` : 'First 4 letters of the IFSC, e.g. SBIN for SBIN0001234.'}
            </p>
          )}
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" className="accent-brand-600" {...register('isActive')} /> Active
        </label>
        {err && <p role="alert" className="rounded-lg bg-danger-50 px-3 py-2 text-sm text-danger-700">{err}</p>}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit" disabled={save.isPending}>{save.isPending ? 'Saving…' : 'Save'}</Button>
        </div>
      </form>
    </Modal>
  );
}

function ConfirmDelete({ bank, onClose, onDeleted }: { bank: BankMaster; onClose: () => void; onDeleted: () => void }) {
  const del = useMutation({ mutationFn: () => hrApi.bankMasters.remove(bank.id), onSuccess: onDeleted });
  return (
    <Modal open title="Delete bank permanently?" onClose={onClose}>
      <p className="text-sm text-ink-700">
        <b>{bank.bank_name}</b> ({bank.ifsc_for_bank}) will be removed. This cannot be undone. To keep it for history, deactivate it instead.
      </p>
      {del.isError && <p role="alert" className="mt-3 rounded-lg bg-danger-50 px-3 py-2 text-sm text-danger-700">{errorMessage(del.error)}</p>}
      <div className="mt-5 flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button variant="danger" disabled={del.isPending} onClick={() => del.mutate()}>{del.isPending ? 'Deleting…' : 'Delete'}</Button>
      </div>
    </Modal>
  );
}
