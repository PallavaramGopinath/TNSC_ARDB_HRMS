import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createColumnHelper } from '@tanstack/react-table';
import { CalendarDays, ChevronRight, Lock, Pencil, Plus, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { DataTable } from '@/components/ui/DataTable';
import { Field } from '@/components/ui/Field';
import { Modal } from '@/components/ui/Modal';
import { PageHeader } from '@/components/ui/PageHeader';
import { Select, enumOptions } from '@/components/ui/Select';
import { useAuth } from '@/hooks/useAuth';
import { MONTHS, formatDate, humanize } from '@/lib/format';
import { errorMessage, fieldErrors } from '@/services/api';
import { coreApi } from '@/services/core';
import { payrollApi, type PeriodInput } from '@/services/payroll';
import type { PayrollPeriod, PeriodStatus } from '@/types/api';
import { PayrollType } from '@/types/enums';

const STATUS_TONE: Record<PeriodStatus, 'brand' | 'warning' | 'success' | 'neutral'> = {
  OPEN: 'brand', PROCESSED: 'warning', APPROVED: 'success', LOCKED: 'neutral',
};
const FLOW: Array<[PeriodStatus, string]> = [
  ['OPEN', 'Created; attendance, deductions and edits allowed'],
  ['PROCESSED', 'Pay bills prepared (Payroll Preparation)'],
  ['APPROVED', 'Approved by a different user than the preparer'],
  ['LOCKED', 'All bills paid; next month opened'],
];
const monthLabel = (p: PayrollPeriod) => `${MONTHS[p.month - 1]!.slice(0, 3)} ${p.calendar_year}`;
const stamp = (who: string | null, at: string | null) =>
  who ? `${who} · ${new Date(at!).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })}` : '—';

const col = createColumnHelper<PayrollPeriod>();

/**
 * Payroll Periods (TNCU /payroll/periods) — ARDB guarded flow: status moves OPEN → PROCESSED → APPROVED only
 * through Payroll Preparation; this screen creates/edits/deletes OPEN periods, sets working days, and locks.
 */
export function PeriodsPage() {
  const qc = useQueryClient();
  const { user } = useAuth();
  const canEdit = !!user && (user.isAdmin || user.roles.includes('Payroll'));
  const [status, setStatus] = useState('');
  const [type, setType] = useState('');
  const [year, setYear] = useState('');
  const [editing, setEditing] = useState<PayrollPeriod | 'new' | null>(null);
  const [workDays, setWorkDays] = useState<PayrollPeriod | null>(null);
  const [locking, setLocking] = useState<PayrollPeriod | null>(null);
  const [deleting, setDeleting] = useState<PeriodTarget>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const { data = [], isLoading } = useQuery({
    queryKey: ['periods', status, type, year],
    queryFn: () => payrollApi.periods.list({ status: status || undefined, payrollType: type || undefined, calendarYear: year ? Number(year) : undefined }),
  });
  const refresh = () => qc.invalidateQueries({ queryKey: ['periods'] });
  const years = useMemo(() => { const y = new Date().getFullYear(); return [y + 1, y, y - 1, y - 2]; }, []);

  const columns = useMemo(
    () => [
      col.display({ id: 'period', header: 'Period', cell: ({ row: { original: p } }) => <span className="font-semibold">{monthLabel(p)}</span> }),
      col.accessor('payroll_type', { header: 'Type', cell: (c) => humanize(c.getValue()) }),
      col.accessor('branch_name', { header: 'Branch' }),
      col.display({ id: 'dates', header: 'From – To', cell: ({ row: { original: p } }) => `${formatDate(p.from_date)} – ${formatDate(p.to_date)}` }),
      col.display({ id: 'days', header: 'Days / working', cell: ({ row: { original: p } }) => <span className="tabular-nums">{p.total_days} / {p.working_days ?? <span className="text-warning-600">not set</span>}</span> }),
      col.accessor('da_rate', { header: 'DA %', cell: (c) => <span className="tabular-nums">{Number(c.getValue()).toFixed(2)}</span> }),
      col.accessor('payroll_status', { header: 'Status', cell: (c) => <Badge tone={STATUS_TONE[c.getValue()]}>{humanize(c.getValue())}</Badge> }),
      col.accessor('bill_count', { header: 'Bills', cell: (c) => <span className="tabular-nums">{c.getValue()}</span> }),
      col.display({ id: 'processed', header: 'Processed', cell: ({ row: { original: p } }) => stamp(p.processed_by, p.processed_at) }),
      col.display({ id: 'approved', header: 'Approved', cell: ({ row: { original: p } }) => stamp(p.approved_by, p.approved_at) }),
      col.display({ id: 'locked', header: 'Locked', cell: ({ row: { original: p } }) => stamp(p.locked_by, p.locked_at) }),
      col.display({
        id: 'actions',
        header: '',
        cell: ({ row: { original: p } }) =>
          canEdit && (
            <div className="flex justify-end gap-1">
              {p.payroll_status === 'OPEN' && (
                <>
                  <Button variant="ghost" title="Edit" aria-label={`Edit ${monthLabel(p)} ${p.payroll_type}`} onClick={() => setEditing(p)}><Pencil size={14} /></Button>
                  <Button variant="ghost" title={p.bill_count ? 'Has pay bills — cannot delete' : 'Delete'} aria-label={`Delete ${monthLabel(p)} ${p.payroll_type}`} disabled={p.bill_count > 0} onClick={() => setDeleting(p)}>
                    <Trash2 size={14} className={p.bill_count ? 'text-ink-300' : 'text-danger-600'} />
                  </Button>
                </>
              )}
              {(p.payroll_status === 'OPEN' || p.payroll_status === 'PROCESSED') && (
                <Button variant="ghost" title="Working days" aria-label={`Working days for ${monthLabel(p)}`} onClick={() => setWorkDays(p)}><CalendarDays size={14} /></Button>
              )}
              {p.payroll_status === 'APPROVED' && p.payroll_type === 'SALARY' && (
                <Button variant="secondary" className="px-2 py-1 text-xs" onClick={() => setLocking(p)}><Lock size={12} /> Lock &amp; open next</Button>
              )}
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
        title="Payroll Periods"
        subtitle="One period per month and pay type · status moves forward through Payroll Preparation"
        actions={canEdit && <Button onClick={() => setEditing('new')}><Plus size={16} /> New period</Button>}
      />

      <ol className="mb-5 grid gap-2 sm:grid-cols-2 xl:grid-cols-4" aria-label="Status flow">
        {FLOW.map(([s, help], i) => (
          <li key={s} className="card flex items-start gap-2 p-3">
            <Badge tone={STATUS_TONE[s]}>{humanize(s)}</Badge>
            <span className="text-xs text-ink-600">{help}</span>
            {i < FLOW.length - 1 && <ChevronRight size={14} className="ml-auto hidden shrink-0 text-ink-300 xl:block" />}
          </li>
        ))}
      </ol>

      <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-3 lg:max-w-2xl">
        <select className="field-input" aria-label="Status" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">All statuses</option>
          {FLOW.map(([s]) => <option key={s} value={s}>{humanize(s)}</option>)}
        </select>
        <select className="field-input" aria-label="Type" value={type} onChange={(e) => setType(e.target.value)}>
          <option value="">All types</option>
          {PayrollType.map((t) => <option key={t} value={t}>{humanize(t)}</option>)}
        </select>
        <select className="field-input" aria-label="Year" value={year} onChange={(e) => setYear(e.target.value)}>
          <option value="">All years</option>
          {years.map((y) => <option key={y} value={y}>{y}</option>)}
        </select>
      </div>

      {notice && <p role="status" className="mb-3 rounded-lg bg-success-50 px-3 py-2 text-sm text-success-700">{notice}</p>}
      <DataTable data={data} columns={columns} loading={isLoading} empty="No payroll periods yet — create the first SALARY month" />

      {editing && (
        <PeriodForm
          initial={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={(p) => { setEditing(null); setNotice(`Saved ${monthLabel(p)} ${humanize(p.payroll_type)}.`); void refresh(); }}
        />
      )}
      {workDays && <WorkingDaysDialog period={workDays} onClose={() => setWorkDays(null)} onSaved={() => { setWorkDays(null); void refresh(); }} />}
      {locking && (
        <LockDialog
          period={locking}
          onClose={() => setLocking(null)}
          onDone={(next) => { setLocking(null); setNotice(`Locked ${monthLabel(locking)}. ${monthLabel(next)} SALARY is open.`); void refresh(); }}
        />
      )}
      {deleting && <DeleteDialog period={deleting} onClose={() => setDeleting(null)} onDone={() => { setDeleting(null); void refresh(); }} />}
    </>
  );
}

type PeriodTarget = PayrollPeriod | null;

interface FormValues extends Omit<PeriodInput, 'month' | 'calendarYear' | 'branchId' | 'daRate'> {
  month: string; calendarYear: string; branchId: string; daRate: string;
}

function monthRange(year: string, month: string) {
  const y = Number(year), m = Number(month);
  if (!y || !m) return null;
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const mm = String(m).padStart(2, '0');
  return { from: `${y}-${mm}-01`, to: `${y}-${mm}-${String(last).padStart(2, '0')}` };
}

function PeriodForm({ initial, onClose, onSaved }: { initial: PayrollPeriod | null; onClose: () => void; onSaved: (p: PayrollPeriod) => void }) {
  const branches = useQuery({ queryKey: ['branches'], queryFn: coreApi.branches, staleTime: 10 * 60_000 });
  const daRates = useQuery({ queryKey: ['da-rates'], queryFn: payrollApi.daRates.list });
  const today = new Date();
  const ho = branches.data?.find((b) => b.type === 'HO');

  const { register, handleSubmit, watch, setValue, setError, formState } = useForm<FormValues>({
    defaultValues: initial
      ? {
          payrollType: initial.payroll_type, month: String(initial.month), calendarYear: String(initial.calendar_year),
          fromDate: initial.from_date, toDate: initial.to_date, branchId: String(initial.branch_id), daRate: String(Number(initial.da_rate)),
          arrearFromDate: initial.arrear_from_date ?? '', arrearToDate: initial.arrear_to_date ?? '',
        }
      : (() => {
          const r = monthRange(String(today.getFullYear()), String(today.getMonth() + 1))!;
          return { payrollType: 'SALARY', month: String(today.getMonth() + 1), calendarYear: String(today.getFullYear()), fromDate: r.from, toDate: r.to, branchId: '', daRate: '', arrearFromDate: '', arrearToDate: '' };
        })(),
  });
  const type = watch('payrollType');
  const toDate = watch('toDate');
  const showArrears = type === 'DA_ARREARS' || type === 'SALARY_ARREARS';
  const [err, setErr] = useState<string | null>(null);

  const rateInForce = daRates.data?.find((r) => r.effective_from <= toDate && (!r.effective_to || r.effective_to >= toDate));
  // New period: default branch to HO and DA to the rate in force on the period's last day.
  useEffect(() => {
    if (!initial && ho) setValue('branchId', String(ho.id));
  }, [initial, ho, setValue]);
  useEffect(() => {
    if (!initial && rateInForce) setValue('daRate', String(Number(rateInForce.percentage)));
  }, [initial, rateInForce, setValue]);

  const syncDates = () => {
    const r = monthRange(watch('calendarYear'), watch('month'));
    if (r) { setValue('fromDate', r.from); setValue('toDate', r.to); }
  };

  const save = useMutation({
    mutationFn: (v: FormValues) => {
      const body: PeriodInput = { ...v, arrearFromDate: showArrears ? v.arrearFromDate : '', arrearToDate: showArrears ? v.arrearToDate : '' };
      return initial ? payrollApi.periods.update(initial.id, body) : payrollApi.periods.create(body);
    },
    onSuccess: onSaved,
    onError: (e) => {
      const fe = fieldErrors(e);
      if (fe) for (const [f, m] of Object.entries(fe)) setError(f as keyof FormValues, { message: m[0] });
      else setErr(errorMessage(e));
    },
  });
  const e = formState.errors;

  return (
    <Modal open title={initial ? `Edit ${MONTHS[initial.month - 1]} ${initial.calendar_year} · ${humanize(initial.payroll_type)}` : 'New payroll period'} onClose={onClose}>
      <form onSubmit={handleSubmit((v) => { setErr(null); save.mutate(v); })} className="space-y-4" noValidate>
        <Select label="Payroll type" options={enumOptions(PayrollType)} {...register('payrollType', { required: 'Choose a payroll type' })} error={e.payrollType?.message} />
        <div className="grid grid-cols-2 gap-3">
          <Select label="Month" options={MONTHS.map((m, i) => ({ value: i + 1, label: m }))} {...register('month', { required: 'Required', onChange: syncDates })} error={e.month?.message} />
          <Field label="Year" type="number" min={2000} max={2100} {...register('calendarYear', { required: 'Required', onChange: syncDates })} error={e.calendarYear?.message} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="From date" type="date" {...register('fromDate', { required: 'Required' })} error={e.fromDate?.message} />
          <Field label="To date" type="date" {...register('toDate', { required: 'Required' })} error={e.toDate?.message} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Select label="Branch" options={(branches.data ?? []).map((b) => ({ value: b.id, label: `${b.name} (${b.code})` }))} {...register('branchId', { required: 'Choose a branch' })} error={e.branchId?.message} hint="Payroll periods are anchored at Head Office" />
          <div>
            <Field label="DA %" type="number" step="0.01" min={0} max={999.99} {...register('daRate')} error={e.daRate?.message} />
            {!e.daRate && <p className="mt-1 text-xs text-ink-500">{rateInForce ? `Rate in force on ${formatDate(toDate)}: ${Number(rateInForce.percentage).toFixed(2)}%` : 'From DA Rates'}</p>}
          </div>
        </div>
        {showArrears && (
          <div className="grid grid-cols-2 gap-3 rounded-lg border border-ink-200 p-3">
            <Field label="Arrears from" type="date" {...register('arrearFromDate')} error={e.arrearFromDate?.message} />
            <Field label="Arrears to" type="date" {...register('arrearToDate')} error={e.arrearToDate?.message} />
          </div>
        )}
        {err && <p role="alert" className="rounded-lg bg-danger-50 px-3 py-2 text-sm text-danger-700">{err}</p>}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit" disabled={save.isPending}>{save.isPending ? 'Saving…' : initial ? 'Save' : 'Create period'}</Button>
        </div>
      </form>
    </Modal>
  );
}

function WorkingDaysDialog({ period, onClose, onSaved }: { period: PayrollPeriod; onClose: () => void; onSaved: () => void }) {
  const [value, setValue] = useState(period.working_days != null ? String(period.working_days) : '');
  const save = useMutation({ mutationFn: () => payrollApi.periods.setWorkingDays(period.id, value === '' ? null : Number(value)), onSuccess: onSaved });
  const invalid = value !== '' && (!/^\d+$/.test(value) || Number(value) > period.total_days);
  return (
    <Modal open title={`Working days · ${monthLabel(period)} ${humanize(period.payroll_type)}`} onClose={onClose}>
      <form onSubmit={(ev) => { ev.preventDefault(); if (!invalid) save.mutate(); }} className="space-y-4">
        <Field label={`Working days (0–${period.total_days})`} type="number" min={0} max={period.total_days} autoFocus value={value} onChange={(ev) => setValue(ev.target.value)} error={invalid ? `Enter 0–${period.total_days}` : undefined} />
        <p className="text-xs text-ink-500">Shown on payslips. Payroll Preparation needs it set before preparing; pay is prorated over the {period.total_days} calendar days.</p>
        {save.isError && <p role="alert" className="rounded-lg bg-danger-50 px-3 py-2 text-sm text-danger-700">{errorMessage(save.error)}</p>}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit" disabled={invalid || save.isPending}>Save</Button>
        </div>
      </form>
    </Modal>
  );
}

function LockDialog({ period, onClose, onDone }: { period: PayrollPeriod; onClose: () => void; onDone: (next: PayrollPeriod) => void }) {
  const lock = useMutation({ mutationFn: () => payrollApi.periods.lockAndRoll(period.id), onSuccess: (r) => onDone(r.next) });
  return (
    <Modal open title={`Lock ${monthLabel(period)} salary?`} onClose={onClose}>
      <ul className="list-disc space-y-1 pl-5 text-sm text-ink-700">
        <li>Every approved pay bill must be paid; withheld bills don't block the lock.</li>
        <li>After locking, bills can no longer be withheld or corrected.</li>
        <li>The next month's SALARY period is opened at Head Office if it doesn't exist.</li>
      </ul>
      {period.unpaid_count > 0 && <p className="mt-3 rounded-lg bg-warning-50 px-3 py-2 text-sm text-warning-700">{period.unpaid_count} approved bill(s) are still unpaid.</p>}
      {lock.isError && <p role="alert" className="mt-3 rounded-lg bg-danger-50 px-3 py-2 text-sm text-danger-700">{errorMessage(lock.error)}</p>}
      <div className="mt-5 flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button disabled={lock.isPending} onClick={() => lock.mutate()}><Lock size={14} /> {lock.isPending ? 'Locking…' : 'Lock & open next'}</Button>
      </div>
    </Modal>
  );
}

function DeleteDialog({ period, onClose, onDone }: { period: PayrollPeriod; onClose: () => void; onDone: () => void }) {
  const del = useMutation({ mutationFn: () => payrollApi.periods.remove(period.id), onSuccess: onDone });
  return (
    <Modal open title="Delete payroll period?" onClose={onClose}>
      <p className="text-sm text-ink-700"><b>{monthLabel(period)} · {humanize(period.payroll_type)}</b> ({period.branch_name}) will be removed.</p>
      {del.isError && <p role="alert" className="mt-3 rounded-lg bg-danger-50 px-3 py-2 text-sm text-danger-700">{errorMessage(del.error)}</p>}
      <div className="mt-5 flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button variant="danger" disabled={del.isPending} onClick={() => del.mutate()}>Delete</Button>
      </div>
    </Modal>
  );
}
