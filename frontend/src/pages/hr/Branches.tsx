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
import { Select } from '@/components/ui/Select';
import { TextArea } from '@/components/ui/TextArea';
import { useAuth } from '@/hooks/useAuth';
import { errorMessage, fieldErrors } from '@/services/api';
import { coreApi } from '@/services/core';
import { hrApi, type BranchInput } from '@/services/hr';
import type { BranchMaster } from '@/types/api';

const col = createColumnHelper<BranchMaster>();

/**
 * Branch master (HR › Masters › Branches). The Head Office is unique and always active.
 * Branches with employees posted can be deactivated but not deleted, and their code is locked.
 */
export function BranchesPage() {
  const qc = useQueryClient();
  const { user } = useAuth();
  const canEdit = !!user && (user.isAdmin || user.roles.includes('HR'));
  const [search, setSearch] = useState('');
  const [showInactive, setShowInactive] = useState(false);
  const [editing, setEditing] = useState<BranchMaster | 'new' | null>(null);
  const [deleting, setDeleting] = useState<BranchMaster | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const { data = [], isLoading } = useQuery({
    queryKey: ['branch-masters', search, showInactive],
    queryFn: () => hrApi.branches.list({ search: search || undefined, includeInactive: showInactive }),
  });
  // Branch dropdowns elsewhere (employees, periods) read ['branches'].
  const refresh = () => Promise.all([qc.invalidateQueries({ queryKey: ['branch-masters'] }), qc.invalidateQueries({ queryKey: ['branches'] })]);

  const toggle = useMutation({
    mutationFn: (b: BranchMaster) => hrApi.branches.setActive(b.id, !b.is_active),
    onSuccess: () => { setActionError(null); void refresh(); },
    onError: (e) => setActionError(errorMessage(e)),
  });

  const columns = useMemo(
    () => [
      col.accessor('code', { header: 'Code', cell: (c) => <code className="rounded bg-ink-100 px-1.5 py-0.5 text-xs font-semibold">{c.getValue()}</code> }),
      col.accessor('name', {
        header: 'Branch name',
        cell: (c) => (
          <span className="flex items-center gap-2">
            {c.getValue()} {c.row.original.type === 'HO' && <Badge tone="brand">Head Office</Badge>}
          </span>
        ),
      }),
      col.accessor('district', { header: 'District', cell: (c) => c.getValue() ?? '—' }),
      col.accessor('place_name', { header: 'Place category', cell: (c) => c.getValue() ?? '—' }),
      col.accessor('employee_count', { header: 'Employees', cell: (c) => <span className="tabular-nums">{c.getValue()}</span> }),
      col.accessor('is_active', { header: 'Status', cell: (c) => (c.getValue() ? <Badge tone="success">Active</Badge> : <Badge>Inactive</Badge>) }),
      col.display({
        id: 'actions',
        header: '',
        cell: ({ row: { original: b } }) => {
          if (!canEdit) return null;
          const isHo = b.type === 'HO';
          const inUse = b.employee_count > 0;
          return (
            <div className="flex justify-end gap-1">
              <Button variant="ghost" aria-label={`Edit ${b.name}`} title="Edit" onClick={() => setEditing(b)}><Pencil size={14} /></Button>
              <Button
                variant="ghost"
                aria-label={`${b.is_active ? 'Deactivate' : 'Activate'} ${b.name}`}
                title={isHo ? 'The Head Office is always active' : b.is_active ? 'Deactivate' : 'Activate'}
                disabled={isHo}
                onClick={() => toggle.mutate(b)}
              >
                <Power size={14} className={isHo ? 'text-ink-300' : b.is_active ? 'text-ink-500' : 'text-success-600'} />
              </Button>
              <Button
                variant="ghost"
                aria-label={`Delete ${b.name}`}
                title={isHo ? 'The Head Office cannot be deleted' : inUse ? 'Employees are posted here — deactivate instead' : 'Delete permanently'}
                disabled={isHo || inUse}
                onClick={() => setDeleting(b)}
              >
                <Trash2 size={14} className={isHo || inUse ? 'text-ink-300' : 'text-danger-600'} />
              </Button>
            </div>
          );
        },
      }),
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [canEdit],
  );

  const hasHo = data.some((b) => b.type === 'HO');

  return (
    <>
      <PageHeader
        title="Branches"
        subtitle="Head Office and branches where employees are posted · the place category drives HRA / CCA"
        actions={canEdit && <Button onClick={() => setEditing('new')}><Plus size={16} /> New branch</Button>}
      />
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <input className="field-input max-w-xs" placeholder="Search code, name or district" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search branches" />
        <label className="flex items-center gap-2 text-sm text-ink-600">
          <input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} className="accent-brand-600" /> Show inactive
        </label>
      </div>
      {actionError && <p role="alert" className="mb-3 rounded-lg bg-danger-50 px-3 py-2 text-sm text-danger-700">{actionError}</p>}
      <DataTable data={data} columns={columns} loading={isLoading} empty="No branches match" />

      {editing && (
        <BranchForm
          initial={editing === 'new' ? null : editing}
          hoTaken={hasHo && (editing === 'new' || editing.type !== 'HO')}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); void refresh(); }}
        />
      )}
      {deleting && (
        <ConfirmDelete
          branch={deleting}
          onClose={() => setDeleting(null)}
          onDeleted={() => { setDeleting(null); void refresh(); }}
        />
      )}
    </>
  );
}

interface FormValues extends Omit<BranchInput, 'placeId'> { placeId: string }

function BranchForm({ initial, hoTaken, onClose, onSaved }: { initial: BranchMaster | null; hoTaken: boolean; onClose: () => void; onSaved: () => void }) {
  const inUse = (initial?.employee_count ?? 0) > 0;
  const isHo = initial?.type === 'HO';
  const places = useQuery({ queryKey: ['place-categories'], queryFn: coreApi.placeCategories, staleTime: 10 * 60_000 });
  const { register, handleSubmit, setError, formState } = useForm<FormValues>({
    defaultValues: {
      code: initial?.code ?? '',
      name: initial?.name ?? '',
      type: initial?.type ?? 'BRANCH',
      address: initial?.address ?? '',
      district: initial?.district ?? '',
      pincode: initial?.pincode ?? '',
      phone: initial?.phone ?? '',
      email: initial?.email ?? '',
      placeId: initial?.place_id != null ? String(initial.place_id) : '',
      isActive: initial?.is_active ?? true,
    },
  });
  const [err, setErr] = useState<string | null>(null);
  const e = formState.errors;

  const save = useMutation({
    mutationFn: (v: FormValues) => {
      const body: BranchInput = { ...v, code: v.code.trim().toUpperCase(), name: v.name.trim(), placeId: v.placeId ? Number(v.placeId) : null };
      return initial ? hrApi.branches.update(initial.id, body) : hrApi.branches.create(body);
    },
    onSuccess: onSaved,
    onError: (ex) => {
      const fe = fieldErrors(ex);
      if (fe) for (const [f, m] of Object.entries(fe)) setError(f as keyof FormValues, { message: m[0] });
      else setErr(errorMessage(ex));
    },
  });

  return (
    <Modal open title={initial ? 'Edit branch' : 'New branch'} onClose={onClose}>
      <form onSubmit={handleSubmit((v) => { setErr(null); save.mutate(v); })} className="space-y-4" noValidate>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <Field
              label="Branch code *"
              autoFocus={!initial}
              maxLength={16}
              placeholder="e.g. CHN01"
              className="field-input font-mono uppercase"
              readOnly={inUse}
              {...register('code', { required: 'Branch code is required', pattern: { value: /^[A-Za-z0-9_-]+$/, message: 'Letters, digits, - or _ only' } })}
              error={e.code?.message}
            />
            {!e.code && inUse && <p className="mt-1 text-xs text-ink-500">Locked — {initial!.employee_count} employee(s) posted here.</p>}
          </div>
          <Select
            label="Type *"
            placeholder="Select type"
            options={isHo ? [{ value: 'HO', label: 'Head Office' }] : [{ value: 'BRANCH', label: 'Branch' }, ...(hoTaken ? [] : [{ value: 'HO', label: 'Head Office' }])]}
            hint={isHo ? 'There is exactly one Head Office' : undefined}
            {...register('type', { required: 'Choose a type' })}
            error={e.type?.message}
          />
        </div>
        <Field
          label="Branch name *"
          autoFocus={!!initial}
          maxLength={200}
          placeholder="e.g. Chennai Main Branch"
          {...register('name', { required: 'Branch name is required', validate: (v) => v.trim().length > 0 || 'Branch name is required' })}
          error={e.name?.message}
        />
        <div className="grid gap-4 sm:grid-cols-2">
          <Select
            label="Place category"
            placeholder="Not set"
            options={(places.data ?? []).map((p) => ({ value: p.id, label: p.name }))}
            {...register('placeId')}
            error={e.placeId?.message}
          />
          <Field label="District" maxLength={100} {...register('district')} error={e.district?.message} />
          <Field
            label="Pincode"
            maxLength={6}
            inputMode="numeric"
            {...register('pincode', { pattern: { value: /^\d{6}$/, message: 'Pincode must be 6 digits' } })}
            error={e.pincode?.message}
          />
          <Field label="Phone" maxLength={20} inputMode="tel" {...register('phone')} error={e.phone?.message} />
        </div>
        <Field label="Email" type="email" maxLength={100} {...register('email')} error={e.email?.message} />
        <TextArea label="Address" maxLength={500} {...register('address')} error={e.address?.message} />
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" className="accent-brand-600" disabled={isHo} {...register('isActive')} /> Active
        </label>
        {e.isActive && <p className="field-error">{e.isActive.message}</p>}
        {err && <p role="alert" className="rounded-lg bg-danger-50 px-3 py-2 text-sm text-danger-700">{err}</p>}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit" disabled={save.isPending}>{save.isPending ? 'Saving…' : 'Save'}</Button>
        </div>
      </form>
    </Modal>
  );
}

function ConfirmDelete({ branch, onClose, onDeleted }: { branch: BranchMaster; onClose: () => void; onDeleted: () => void }) {
  const del = useMutation({ mutationFn: () => hrApi.branches.remove(branch.id), onSuccess: onDeleted });
  return (
    <Modal open title="Delete branch permanently?" onClose={onClose}>
      <p className="text-sm text-ink-700">
        <b>{branch.name}</b> ({branch.code}) will be removed. This cannot be undone. To keep it for history, deactivate it instead.
      </p>
      {del.isError && <p role="alert" className="mt-3 rounded-lg bg-danger-50 px-3 py-2 text-sm text-danger-700">{errorMessage(del.error)}</p>}
      <div className="mt-5 flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button variant="danger" disabled={del.isPending} onClick={() => del.mutate()}>{del.isPending ? 'Deleting…' : 'Delete'}</Button>
      </div>
    </Modal>
  );
}
