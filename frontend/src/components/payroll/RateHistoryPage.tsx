import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createColumnHelper } from '@tanstack/react-table';
import { CalendarClock, Percent } from 'lucide-react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { DataTable } from '@/components/ui/DataTable';
import { Field } from '@/components/ui/Field';
import { Modal } from '@/components/ui/Modal';
import { PageHeader } from '@/components/ui/PageHeader';
import { useAuth } from '@/hooks/useAuth';
import { formatDate } from '@/lib/format';
import { errorMessage, fieldErrors } from '@/services/api';
import type { RateApi } from '@/services/payroll';
import type { EffectiveRate } from '@/types/api';

const col = createColumnHelper<EffectiveRate>();
const pct = (v: string | number) => `${Number(v).toFixed(2)} %`;
const dayBefore = (d: string) => {
  const t = new Date(`${d}T00:00:00Z`);
  t.setUTCDate(t.getUTCDate() - 1);
  return t.toISOString().slice(0, 10);
};

const columns = [
  col.accessor('effective_from', { header: 'From', cell: (c) => formatDate(c.getValue()) }),
  col.accessor('effective_to', { header: 'To', cell: (c) => (c.getValue() ? formatDate(c.getValue()) : <span className="text-ink-500">Open</span>) }),
  col.accessor('percentage', { header: () => <span className="block text-right">Rate</span>, cell: (c) => <span className="block text-right font-semibold tabular-nums">{pct(c.getValue())}</span> }),
  col.accessor('is_active', { header: 'Status', cell: (c) => (c.getValue() ? <Badge tone="success">Current</Badge> : <Badge>Closed</Badge>) }),
  col.accessor('created_by', { header: 'Entered by' }),
  col.accessor('created_at', { header: 'Entered on', cell: (c) => new Date(c.getValue()).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }) }),
];

interface FormValues { effectiveFrom: string; percentage: string }

export interface RateHistoryPageProps {
  title: string;
  subtitle: string;
  /** Short name used in labels and messages: 'DA' or 'PF'. */
  label: string;
  /** Upper limit for the percentage. */
  max: number;
  queryKey: string;
  api: RateApi;
  /** Extra line in the confirm dialog. */
  confirmNote: string;
  example: string;
}

/**
 * Effective-dated rate screen shared by DA Rates and PF Rates (TNCU /payroll/rates/{da,pf}).
 * Append-only: a revision is added as a new rate, which closes the current one the day before.
 */
export function RateHistoryPage({ title, subtitle, label, max, queryKey, api, confirmNote, example }: RateHistoryPageProps) {
  const qc = useQueryClient();
  const { user } = useAuth();
  const canAdd = !!user && (user.isAdmin || user.roles.includes('Payroll'));
  const history = useQuery({ queryKey: [queryKey], queryFn: api.list });
  const current = history.data?.find((r) => r.is_active) ?? null;

  const { register, handleSubmit, watch, reset, setError, formState } = useForm<FormValues>({ defaultValues: { effectiveFrom: '', percentage: '' } });
  const [pending, setPending] = useState<FormValues | null>(null);
  const [topError, setTopError] = useState<string | null>(null);
  const from = watch('effectiveFrom');
  const rate = watch('percentage');

  const save = useMutation({
    mutationFn: (v: FormValues) => api.create(v.effectiveFrom, v.percentage),
    onSuccess: () => {
      setPending(null);
      setTopError(null);
      reset();
      void qc.invalidateQueries({ queryKey: [queryKey] });
    },
    onError: (e) => {
      setPending(null);
      const fe = fieldErrors(e);
      if (fe) for (const [f, m] of Object.entries(fe)) setError((f === 'effectiveFrom' ? f : 'percentage') as keyof FormValues, { message: m[0] });
      else setTopError(errorMessage(e));
    },
  });

  const fromTooEarly = !!(current && from && from <= current.effective_from);

  return (
    <>
      <PageHeader title={title} subtitle={subtitle} />

      <div className="mb-6 grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
        <div className="card flex items-center gap-5 p-5">
          <div className="flex h-14 w-14 items-center justify-center rounded-xl bg-brand-50 text-brand-600"><Percent size={26} /></div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-ink-500">Current {label} rate</p>
            {current ? (
              <>
                <p className="text-3xl font-bold tabular-nums text-ink-900">{pct(current.percentage)}</p>
                <p className="text-sm text-ink-500">from {formatDate(current.effective_from)} · entered by {current.created_by}</p>
              </>
            ) : (
              <p className="text-sm text-ink-500">{history.isLoading ? 'Loading…' : 'No rate set yet'}</p>
            )}
          </div>
        </div>

        {canAdd && (
          <form className="card p-5" noValidate onSubmit={handleSubmit((v) => { setTopError(null); setPending(v); })}>
            <p className="mb-3 flex items-center gap-2 text-sm font-bold uppercase tracking-wide text-ink-700"><CalendarClock size={16} /> New {label} rate</p>
            <div className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-start">
              <Field label="Effective from" type="date" {...register('effectiveFrom', { required: 'Effective-from date is required' })} error={formState.errors.effectiveFrom?.message ?? (fromTooEarly ? `Must be after ${formatDate(current!.effective_from)}` : undefined)} />
              <Field
                label={`${label} %`}
                type="number"
                step="0.01"
                min={0}
                max={max}
                placeholder={`e.g. ${example}`}
                {...register('percentage', {
                  required: `Enter the ${label} percentage`,
                  min: { value: 0, message: 'Cannot be negative' },
                  max: { value: max, message: `At most ${max}` },
                  validate: (v) => /^\d+(\.\d{1,2})?$/.test(v.trim()) || 'At most 2 decimals',
                })}
                error={formState.errors.percentage?.message}
              />
              <Button type="submit" className="sm:mt-5" disabled={fromTooEarly || save.isPending}>Add rate</Button>
            </div>
            {current && from && !fromTooEarly && (
              <p className="mt-3 rounded-lg bg-brand-25 px-3 py-2 text-sm text-ink-700">
                The current rate <b>{pct(current.percentage)}</b> (from {formatDate(current.effective_from)}) will close on <b>{formatDate(dayBefore(from))}</b>
                {rate !== '' && <> and <b>{pct(rate)}</b> applies from <b>{formatDate(from)}</b></>}.
              </p>
            )}
            {topError && <p role="alert" className="mt-3 rounded-lg bg-danger-50 px-3 py-2 text-sm text-danger-700">{topError}</p>}
          </form>
        )}
      </div>

      <h2 className="mb-2 text-sm font-bold uppercase tracking-wide text-ink-700">History</h2>
      <DataTable data={history.data ?? []} columns={columns} loading={history.isLoading} empty={`No ${label} rates`} />

      {pending && (
        <Modal open title={`Add ${label} rate?`} onClose={() => setPending(null)}>
          <p className="text-sm text-ink-700">
            {label} <b>{pct(pending.percentage)}</b> from <b>{formatDate(pending.effectiveFrom)}</b>.
            {current && <> The current {pct(current.percentage)} closes on {formatDate(dayBefore(pending.effectiveFrom))}.</>}
          </p>
          <p className="mt-2 text-xs text-ink-500">Rate history cannot be edited or deleted afterwards. {confirmNote}</p>
          <div className="mt-5 flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setPending(null)}>Cancel</Button>
            <Button disabled={save.isPending} onClick={() => save.mutate(pending)}>{save.isPending ? 'Saving…' : 'Confirm'}</Button>
          </div>
        </Modal>
      )}
    </>
  );
}
