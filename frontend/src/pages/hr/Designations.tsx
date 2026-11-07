import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createColumnHelper } from '@tanstack/react-table';
import { Pencil, Plus } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { DataTable } from '@/components/ui/DataTable';
import { Field } from '@/components/ui/Field';
import { Modal } from '@/components/ui/Modal';
import { PageHeader } from '@/components/ui/PageHeader';
import { errorMessage } from '@/services/api';
import { hrApi } from '@/services/hr';
import type { Designation } from '@/types/api';

/** Reference CRUD screen (TNCU /hr/designations): name, grade, pay level, seniority, active. */
const schema = z.object({
  designationName: z.string().trim().min(1, 'Designation name is required').max(150),
  grade: z.string().max(50).optional(),
  payLevel: z.string().max(50).optional(),
  seniorityOrder: z.union([z.literal(''), z.coerce.number().int().min(1, '1–999').max(999, '1–999')]).optional(),
  isActive: z.boolean(),
});
type Form = z.infer<typeof schema>;

const col = createColumnHelper<Designation>();

export function DesignationsPage() {
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const [showInactive, setShowInactive] = useState(false);
  const [editing, setEditing] = useState<Designation | 'new' | null>(null);

  const { data = [], isLoading } = useQuery({
    queryKey: ['designations', search, showInactive],
    queryFn: () => hrApi.designations.list({ search: search || undefined, includeInactive: showInactive }),
  });

  const columns = useMemo(
    () => [
      col.accessor('seniority_order', { header: 'Seniority', cell: (c) => c.getValue() ?? '—' }),
      col.accessor('designation_name', { header: 'Designation' }),
      col.accessor('grade', { header: 'Grade', cell: (c) => c.getValue() ?? '—' }),
      col.accessor('pay_level', { header: 'Pay level', cell: (c) => c.getValue() ?? '—' }),
      col.accessor('is_active', { header: 'Status', cell: (c) => (c.getValue() ? <Badge tone="success">Active</Badge> : <Badge>Inactive</Badge>) }),
      col.display({
        id: 'actions',
        header: '',
        cell: (c) => (
          <Button variant="ghost" aria-label={`Edit ${c.row.original.designation_name}`} onClick={() => setEditing(c.row.original)}>
            <Pencil size={14} />
          </Button>
        ),
      }),
    ],
    [],
  );

  return (
    <>
      <PageHeader
        title="Designations"
        subtitle="HR master · seniority 1 is the most senior"
        actions={<Button onClick={() => setEditing('new')}><Plus size={16} /> New designation</Button>}
      />
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <input className="field-input max-w-xs" placeholder="Search designation" value={search} onChange={(e) => setSearch(e.target.value)} />
        <label className="flex items-center gap-2 text-sm text-ink-600">
          <input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} className="accent-brand-600" /> Show inactive
        </label>
      </div>
      <DataTable data={data} columns={columns} loading={isLoading} empty="No designations yet" />
      {editing && (
        <DesignationForm
          initial={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            void qc.invalidateQueries({ queryKey: ['designations'] });
          }}
        />
      )}
    </>
  );
}

function DesignationForm({ initial, onClose, onSaved }: { initial: Designation | null; onClose: () => void; onSaved: () => void }) {
  const { register, handleSubmit, formState } = useForm<Form>({
    resolver: zodResolver(schema),
    defaultValues: {
      designationName: initial?.designation_name ?? '',
      grade: initial?.grade ?? '',
      payLevel: initial?.pay_level ?? '',
      seniorityOrder: initial?.seniority_order ?? '',
      isActive: initial?.is_active ?? true,
    },
  });
  const save = useMutation({
    mutationFn: (v: Form) => {
      const body = { ...v, seniorityOrder: v.seniorityOrder === '' ? undefined : v.seniorityOrder };
      return initial ? hrApi.designations.update(initial.id, body) : hrApi.designations.create(body);
    },
    onSuccess: onSaved,
  });

  return (
    <Modal open title={initial ? 'Edit designation' : 'New designation'} onClose={onClose}>
      <form onSubmit={handleSubmit((v) => save.mutate(v))} className="space-y-4" noValidate>
        <Field label="Designation name" autoFocus {...register('designationName')} error={formState.errors.designationName?.message} />
        <div className="grid grid-cols-3 gap-3">
          <Field label="Grade" {...register('grade')} error={formState.errors.grade?.message} />
          <Field label="Pay level" {...register('payLevel')} error={formState.errors.payLevel?.message} />
          <Field label="Seniority" type="number" min={1} max={999} {...register('seniorityOrder')} error={formState.errors.seniorityOrder?.message} />
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" className="accent-brand-600" {...register('isActive')} /> Active
        </label>
        {save.isError && <p role="alert" className="rounded-lg bg-danger-50 px-3 py-2 text-sm text-danger-700">{errorMessage(save.error)}</p>}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit" disabled={save.isPending}>{save.isPending ? 'Saving…' : 'Save'}</Button>
        </div>
      </form>
    </Modal>
  );
}
