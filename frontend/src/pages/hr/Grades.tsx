import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createColumnHelper } from '@tanstack/react-table';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { DataTable } from '@/components/ui/DataTable';
import { Field } from '@/components/ui/Field';
import { Modal } from '@/components/ui/Modal';
import { PageHeader } from '@/components/ui/PageHeader';
import { errorMessage, fieldErrors } from '@/services/api';
import { hrApi } from '@/services/hr';
import type { Grade } from '@/types/api';

const col = createColumnHelper<Grade>();
const designations = (n: number) => `${n} designation${n === 1 ? '' : 's'}`;

/** Grades master (specs/03-grade-master.md): feeds the Grade dropdown on designations. */
export function GradesPage() {
  const qc = useQueryClient();
  const [showInactive, setShowInactive] = useState(false);
  const [editing, setEditing] = useState<Grade | 'new' | null>(null);
  const [deleting, setDeleting] = useState<Grade | null>(null);

  const { data = [], isLoading } = useQuery({
    queryKey: ['grades', showInactive ? 'all' : 'active'],
    queryFn: () => hrApi.grades.list({ active: !showInactive }),
  });
  // Renaming a grade also renames it on its designations.
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['grades'] });
    void qc.invalidateQueries({ queryKey: ['designations'] });
  };

  const columns = useMemo(
    () => [
      col.accessor('grade_code', { header: 'Grade code' }),
      col.accessor('description', { header: 'Description', cell: (c) => c.getValue() ?? '—' }),
      col.accessor('display_order', { header: 'Display order', cell: (c) => <span className="tabular-nums">{c.getValue() ?? '—'}</span> }),
      col.accessor('is_active', { header: 'Status', cell: (c) => (c.getValue() ? <Badge tone="success">Active</Badge> : <Badge>Inactive</Badge>) }),
      col.accessor('usage_count', { header: 'Designations', cell: (c) => <span className="tabular-nums">{c.getValue()}</span> }),
      col.display({
        id: 'actions',
        header: '',
        cell: ({ row: { original: g } }) => {
          const deleteBlock = g.usage_count > 0 ? 'In use — deactivate instead' : null;
          return (
            <div className="flex justify-end gap-1">
              <Button variant="ghost" aria-label={`Edit ${g.grade_code}`} title="Edit" onClick={() => setEditing(g)}><Pencil size={14} /></Button>
              <Button variant="ghost" aria-label={`Delete ${g.grade_code}`} title={deleteBlock ?? 'Delete permanently'} disabled={!!deleteBlock} onClick={() => setDeleting(g)}>
                <Trash2 size={14} className={deleteBlock ? 'text-ink-300' : 'text-danger-600'} />
              </Button>
            </div>
          );
        },
      }),
    ],
    [],
  );

  return (
    <>
      <PageHeader
        title="Grades"
        subtitle="HR master · active grades are listed in the designation's Grade dropdown"
        actions={<Button onClick={() => setEditing('new')}><Plus size={16} /> New grade</Button>}
      />
      <label className="mb-4 flex items-center gap-2 text-sm text-ink-600">
        <input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} className="accent-brand-600" /> Show inactive
      </label>
      <DataTable data={data} columns={columns} loading={isLoading} empty="No grades yet" />
      {editing && (
        <GradeForm
          initial={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); refresh(); }}
        />
      )}
      {deleting && <ConfirmDelete grade={deleting} onClose={() => setDeleting(null)} onDeleted={() => { setDeleting(null); refresh(); }} />}
    </>
  );
}

interface FormValues { gradeCode: string; description: string; displayOrder: string; isActive: boolean }

function GradeForm({ initial, onClose, onSaved }: { initial: Grade | null; onClose: () => void; onSaved: () => void }) {
  const { register, handleSubmit, setError, watch, formState } = useForm<FormValues>({
    defaultValues: {
      gradeCode: initial?.grade_code ?? '',
      description: initial?.description ?? '',
      displayOrder: initial?.display_order == null ? '' : String(initial.display_order),
      isActive: initial?.is_active ?? true,
    },
  });
  const [err, setErr] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: (v: FormValues) => (initial ? hrApi.grades.update(initial.id, v) : hrApi.grades.create(v)),
    onSuccess: onSaved,
    onError: (e) => {
      const fe = fieldErrors(e);
      if (fe) for (const [f, m] of Object.entries(fe)) setError(f as keyof FormValues, { message: m[0] });
      else setErr(errorMessage(e));
    },
  });

  const code = watch('gradeCode').trim();
  const renames = initial && initial.usage_count > 0 && code !== '' && code !== initial.grade_code;

  return (
    <Modal open title={initial ? 'Edit grade' : 'New grade'} onClose={onClose}>
      <form onSubmit={handleSubmit((v) => { setErr(null); save.mutate(v); })} className="space-y-4" noValidate>
        <div className="grid grid-cols-3 gap-3">
          <div className="col-span-2">
            <Field
              label="Grade code"
              autoFocus
              maxLength={50}
              {...register('gradeCode', { validate: (v) => v.trim() !== '' || 'Grade code is required' })}
              error={formState.errors.gradeCode?.message}
            />
          </div>
          <Field
            label="Display order"
            type="number"
            min={1}
            max={999}
            step={1}
            {...register('displayOrder', { validate: (v) => v === '' || (Number.isInteger(Number(v)) && Number(v) >= 1 && Number(v) <= 999) || '1–999' })}
            error={formState.errors.displayOrder?.message}
          />
        </div>
        {renames && <p className="text-xs text-ink-500">{designations(initial.usage_count)} using this grade will be updated to “{code}”.</p>}
        <Field label="Description (optional)" maxLength={150} {...register('description')} error={formState.errors.description?.message} />
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

function ConfirmDelete({ grade, onClose, onDeleted }: { grade: Grade; onClose: () => void; onDeleted: () => void }) {
  const del = useMutation({ mutationFn: () => hrApi.grades.remove(grade.id), onSuccess: onDeleted });
  return (
    <Modal open title="Delete grade permanently?" onClose={onClose}>
      <p className="text-sm text-ink-700"><b>{grade.grade_code}</b> will be removed. This cannot be undone.</p>
      {del.isError && <p role="alert" className="mt-3 rounded-lg bg-danger-50 px-3 py-2 text-sm text-danger-700">{errorMessage(del.error)}</p>}
      <div className="mt-5 flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button variant="danger" disabled={del.isPending} onClick={() => del.mutate()}>{del.isPending ? 'Deleting…' : 'Delete'}</Button>
      </div>
    </Modal>
  );
}
