import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Calculator, CheckCircle2, ClipboardList, Landmark, Lock, RefreshCw, RotateCcw, Undo2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { AgencyDialog } from '@/components/payroll/preparation/AgencyDialog';
import { AttendanceDialog } from '@/components/payroll/preparation/AttendanceDialog';
import { BillDialog } from '@/components/payroll/preparation/BillDialog';
import { EditDeductionsDialog } from '@/components/payroll/preparation/EditDeductionsDialog';
import { PayrollGrid } from '@/components/payroll/preparation/PayrollGrid';
import { ReadinessPanel } from '@/components/payroll/preparation/ReadinessPanel';
import { AskDialog, ErrorText } from '@/components/payroll/preparation/shared';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { PageHeader } from '@/components/ui/PageHeader';
import { Select } from '@/components/ui/Select';
import { useAuth } from '@/hooks/useAuth';
import { formatDate, formatINR, humanize, MONTHS } from '@/lib/format';
import { apiError, errorMessage } from '@/services/api';
import { payrollApi } from '@/services/payroll';
import type { PayBill, PayrollPeriod, PayrollRunGrid, PeriodStatus, PrepareResult } from '@/types/api';
import { LockDialog } from './Periods';

/** Payroll › Processing › Payroll Preparation (specs/08): the monthly SALARY run of all employees of all branches. */
const STATUS_TONE = { OPEN: 'brand', PROCESSED: 'warning', APPROVED: 'success', LOCKED: 'neutral' } as const;
const HINT: Record<PeriodStatus, string> = {
  OPEN: 'Enter attendance, then Prepare to compute DRAFT payroll.',
  PROCESSED: 'Prepared. A different user can Approve (freeze) or Reject back to OPEN.',
  APPROVED: 'Frozen. Lock & Open Next to close this month and open the following one.',
  LOCKED: 'Locked. This run is closed.',
};
const label = (p: PayrollPeriod) => `${MONTHS[p.month - 1]} ${p.calendar_year}`;
const LIST_KEY = ['payroll-periods', 'SALARY'];

type Dialog =
  | { kind: 'attendance' | 'agency' | 'approve' | 'reject' | 'reverse' | 'lock' }
  | { kind: 'confirmAttendance'; message: string }
  | { kind: 'view' | 'edit' | 'withhold'; bill: PayBill };

export function PreparationPage() {
  const qc = useQueryClient();
  const { user } = useAuth();
  const canEdit = !!user && (user.isAdmin || user.roles.includes('Payroll'));
  const [chosen, setChosen] = useState<number | null>(null);
  const [branch, setBranch] = useState('');
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);

  const list = useQuery({ queryKey: LIST_KEY, queryFn: () => payrollApi.periods.list({ payrollType: 'SALARY' }) });
  const periods = useMemo(() => [...(list.data ?? [])].sort((a, b) => a.from_date.localeCompare(b.from_date) || a.id - b.id), [list.data]);
  const pending = periods.find((p) => p.payroll_status !== 'LOCKED');
  // Every month is locked (or there is none): open the next one. HR cannot, and sees the latest.
  const resolve = useQuery({
    queryKey: ['payroll-periods', 'resolve'],
    queryFn: async () => { const p = await payrollApi.periods.resolveActive(); await qc.invalidateQueries({ queryKey: LIST_KEY }); return p; },
    enabled: canEdit && list.isSuccess && !pending,
    retry: false,
    gcTime: 0,
  });
  const selected = periods.find((p) => p.id === chosen) ?? pending ?? periods[periods.length - 1];
  const periodId = selected?.id ?? 0;
  const run = useQuery({ queryKey: ['payroll-run', periodId], queryFn: () => payrollApi.preparation.grid(periodId), enabled: periodId > 0 });
  const p = run.data?.period ?? selected;
  useEffect(() => { setNotice(null); setError(null); }, [periodId]);

  const refresh = () => {
    for (const key of ['payroll-run', 'payroll-readiness', 'payroll-periods', 'periods', 'allowance-preview', 'pay-bill', 'manual-deductions']) void qc.invalidateQueries({ queryKey: [key] });
  };
  const done = (message: string | null) => { setDialog(null); setNotice(message); setError(null); refresh(); };
  const prepared = (r: PrepareResult) => done(`Computed ${r.bills} payroll(s), ${r.lines} line(s), ${r.errors} error(s), ${r.warnings} warning(s).`);

  const prepare = useMutation({
    mutationFn: (confirm: boolean) => payrollApi.preparation.prepare(periodId, confirm),
    onSuccess: prepared,
    onError: (e) => {
      const err = apiError(e);
      if (err?.code === 'CONFIRM_ATTENDANCE') setDialog({ kind: 'confirmAttendance', message: err.message });
      else { setDialog(null); setNotice(null); setError(e); }
    },
  });
  const approve = useMutation({ mutationFn: () => payrollApi.preparation.approve(periodId), onSuccess: () => done('Run approved. The pay bills are frozen.'), onError: refresh });
  const reject = useMutation({ mutationFn: (reason: string) => payrollApi.periods.reject(periodId, reason), onSuccess: () => done('Run rejected. The period is OPEN again.') });
  const reverse = useMutation({ mutationFn: (reason: string) => payrollApi.periods.reverseApproval(periodId, reason), onSuccess: () => done('Approval reversed. The pay bills are drafts again.') });
  const withhold = useMutation({
    mutationFn: (v: { bill: PayBill; withheld: boolean; reason?: string }) => payrollApi.preparation.withhold(v.bill.id, v.withheld, v.reason),
    onSuccess: (_r, v) => done(`${v.bill.employee_code} ${v.withheld ? 'is withheld' : 'is no longer withheld'}.`),
    onError: (e, v) => { if (!v.withheld) setError(e); },
  });
  const ask = (d: Dialog) => { for (const m of [approve, reject, reverse, withhold, prepare]) m.reset(); setDialog(d); };

  const busy = prepare.isPending || approve.isPending || reject.isPending || reverse.isPending || withhold.isPending;
  const bills = run.data?.bills ?? [];
  const view = bills.filter((b) => !branch || b.branch_id === Number(branch));
  const branches = [...new Map(bills.map((b) => [b.branch_id, b.branch_name]))].sort((a, b) => a[1].localeCompare(b[1]));
  const editable = p?.payroll_status === 'OPEN' || p?.payroll_status === 'PROCESSED';
  const isMaker = !!user && !!p?.processed_by && user.username.toLowerCase() === p.processed_by.toLowerCase();
  const fileLabel = p ? `${p.calendar_year}-${String(p.month).padStart(2, '0')}` : '';

  return (
    <>
      <PageHeader
        title="Payroll Preparation"
        subtitle="Monthly salary of Head Office and all branches: prepare, review, approve"
        actions={<Button variant="secondary" disabled={busy} onClick={refresh}><RefreshCw size={14} /> Refresh</Button>}
      />
      {list.isError && <ErrorText>{errorMessage(list.error)}</ErrorText>}
      {resolve.isError && <ErrorText>{errorMessage(resolve.error)}</ErrorText>}
      {list.isSuccess && periods.length === 0 && !resolve.isFetching && !resolve.isError && <p className="card p-5 text-sm text-ink-600">No salary period exists yet. Create the first month in Payroll Periods.</p>}

      {p && (
        <div className="space-y-4">
          <PeriodPicker periods={periods} selected={p} onSelect={setChosen} branch={branch} branches={branches} onBranch={setBranch} />

          <div className="card flex flex-wrap items-center gap-x-5 gap-y-2 p-4 text-sm">
            <span className="text-base font-bold text-ink-900">{label(p)} · Salary</span>
            <Badge tone={STATUS_TONE[p.payroll_status]}>{humanize(p.payroll_status)}</Badge>
            <span className="text-ink-600">{p.branch_name} · {formatDate(p.from_date)} to {formatDate(p.to_date)}</span>
            <span className="text-ink-600">{HINT[p.payroll_status]}</span>
            {p.processed_by && <span className="text-xs text-ink-500">Prepared by {p.processed_by}{p.approved_by && ` · approved by ${p.approved_by}`}</span>}
          </div>
          {p.return_reason && (
            <p className="rounded-lg bg-warning-50 px-4 py-2 text-sm text-warning-700">{p.payroll_status === 'OPEN' ? 'Rejected' : 'Approval reversed'} by {p.returned_by}: {p.return_reason}</p>
          )}

          <ReadinessPanel periodId={periodId} />

          {canEdit && (
            <div className="card space-y-4 p-4">
              <div className="flex flex-wrap items-end gap-3">
                <WorkingDays key={`${p.id}-${p.working_days}`} period={p} disabled={!editable || busy} onSaved={() => done('Working days saved.')} />
                <Button variant="secondary" disabled={!editable || busy} onClick={() => ask({ kind: 'attendance' })}><ClipboardList size={14} /> Attendance</Button>
                <Button variant="secondary" disabled={!editable || busy} onClick={() => ask({ kind: 'agency' })}><Landmark size={14} /> Agency Deductions</Button>
              </div>
              <div className="flex flex-wrap items-center gap-2 border-t border-ink-200 pt-4">
                <Button disabled={!editable || busy} onClick={() => prepare.mutate(false)}><Calculator size={14} /> {prepare.isPending ? 'Preparing…' : bills.length ? 'Re-prepare Payroll' : 'Prepare Payroll'}</Button>
                <Button disabled={p.payroll_status !== 'PROCESSED' || bills.length === 0 || busy || (isMaker && !user.isAdmin)} title={isMaker && !user.isAdmin ? 'The run must be approved by another user' : undefined} onClick={() => ask({ kind: 'approve' })}><CheckCircle2 size={14} /> Approve Run</Button>
                <Button variant="secondary" disabled={p.payroll_status !== 'PROCESSED' || busy || isMaker} title={isMaker ? 'The run must be rejected by another user' : undefined} onClick={() => ask({ kind: 'reject' })}><Undo2 size={14} /> Reject</Button>
                <Button variant="secondary" disabled={p.payroll_status !== 'APPROVED' || busy} onClick={() => ask({ kind: 'lock' })}><Lock size={14} /> Lock &amp; Open Next</Button>
                {user.isAdmin && p.payroll_status === 'APPROVED' && <Button variant="secondary" disabled={busy} onClick={() => ask({ kind: 'reverse' })}><RotateCcw size={14} /> Reverse approval</Button>}
              </div>
              {isMaker && p.payroll_status === 'PROCESSED' && <p className="text-xs text-ink-500">{user.isAdmin ? 'You prepared this run: you may approve it, but another user must reject it.' : 'You prepared this run: another user must approve or reject it.'}</p>}
            </div>
          )}

          {notice && <p role="status" className="rounded-lg bg-success-50 px-3 py-2 text-sm text-success-700">{notice}</p>}
          {!!error && <ErrorText>{errorMessage(error)}</ErrorText>}
          {run.isError && <ErrorText>{errorMessage(run.error)}</ErrorText>}
          {run.data && <RunMessages run={run.data} />}
          {run.data && bills.length > 0 && <Summary summary={run.data.summary} />}
          <PayrollGrid
            key={periodId} bills={view} loading={run.isLoading} fileLabel={fileLabel} busy={busy}
            canWithhold={canEdit && p.payroll_status !== 'LOCKED'} canEditDeductions={canEdit && editable}
            onView={(bill) => ask({ kind: 'view', bill })} onEdit={(bill) => ask({ kind: 'edit', bill })}
            onWithhold={(bill) => (bill.is_withheld ? withhold.mutate({ bill, withheld: false }) : ask({ kind: 'withhold', bill }))}
          />

          {dialog?.kind === 'attendance' && <AttendanceDialog periodId={periodId} periodLabel={label(p)} fileLabel={fileLabel} onClose={() => setDialog(null)} onSaved={(m) => { setNotice(m); refresh(); }} />}
          {dialog?.kind === 'agency' && <AgencyDialog periodId={periodId} periodLabel={label(p)} fileLabel={fileLabel} onClose={() => setDialog(null)} onSaved={(m) => { setNotice(m); refresh(); }} />}
          {dialog?.kind === 'confirmAttendance' && (
            <AskDialog title="Attendance not entered" message={`${dialog.message} Prepare anyway?`} action="Prepare" busy={prepare.isPending} error={null} onYes={() => prepare.mutate(true)} onClose={() => setDialog(null)} />
          )}
          {dialog?.kind === 'approve' && (
            <AskDialog title={`Approve ${label(p)} salary?`} message={<>{bills.length} pay bills, net <b>{formatINR(bills.reduce((n, b) => n + Number(b.net_salary), 0))}</b>. Attendance, deductions and pay bills can then no longer be changed.</>} action="Approve Run" busy={approve.isPending} error={approve.error} onYes={() => approve.mutate()} onClose={() => setDialog(null)} />
          )}
          {dialog?.kind === 'reject' && <AskDialog title={`Reject ${label(p)} salary?`} message="The period goes back to OPEN. The draft bills stay until payroll is prepared again." action="Reject" reason="required" busy={reject.isPending} error={reject.error} onYes={(r) => reject.mutate(r)} onClose={() => setDialog(null)} />}
          {dialog?.kind === 'reverse' && <AskDialog title={`Reverse the approval of ${label(p)}?`} message="The pay bills become drafts again, and must be approved again before payment." action="Reverse approval" reason="required" busy={reverse.isPending} error={reverse.error} onYes={(r) => reverse.mutate(r)} onClose={() => setDialog(null)} />}
          {dialog?.kind === 'withhold' && (
            <AskDialog title={`Withhold the salary of ${dialog.bill.employee_name}?`} message="The bill is prepared and approved with the rest, but left out of the bulk payment." action="Withhold" reason="optional" maxLength={256} busy={withhold.isPending} error={withhold.error} onYes={(reason) => withhold.mutate({ bill: dialog.bill, withheld: true, reason })} onClose={() => setDialog(null)} />
          )}
          {dialog?.kind === 'view' && <BillDialog billId={dialog.bill.id} onClose={() => setDialog(null)} />}
          {dialog?.kind === 'edit' && <EditDeductionsDialog periodId={periodId} employeeId={dialog.bill.employee_id} onClose={() => setDialog(null)} onSaved={prepared} />}
          {dialog?.kind === 'lock' && <LockDialog period={p} onClose={() => setDialog(null)} onDone={(next) => { setChosen(next.id); done(null); }} />}
        </div>
      )}
    </>
  );
}

interface PickerProps {
  periods: PayrollPeriod[];
  selected: PayrollPeriod;
  onSelect: (id: number) => void;
  branch: string;
  branches: Array<[number, string]>;
  onBranch: (v: string) => void;
}
function PeriodPicker({ periods, selected, onSelect, branch, branches, onBranch }: PickerProps) {
  const years = [...new Set(periods.map((x) => x.calendar_year))].sort((a, b) => b - a);
  const inYear = periods.filter((x) => x.calendar_year === selected.calendar_year);
  const months = [...new Set(inYear.map((x) => x.month))].sort((a, b) => a - b);
  const inMonth = inYear.filter((x) => x.month === selected.month);
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:max-w-4xl lg:grid-cols-4">
      <Select label="Year" name="year" value={selected.calendar_year} options={years.map((y) => ({ value: y, label: String(y) }))}
        onChange={(e) => { const first = periods.filter((x) => x.calendar_year === Number(e.target.value)); if (first.length) onSelect(first[first.length - 1]!.id); }} />
      <Select label="Month" name="month" value={selected.month} options={months.map((m) => ({ value: m, label: MONTHS[m - 1]! }))}
        onChange={(e) => { const hit = inYear.find((x) => x.month === Number(e.target.value)); if (hit) onSelect(hit.id); }} />
      {inMonth.length > 1 && (
        <Select label="Period" name="period" value={selected.id} options={inMonth.map((x) => ({ value: x.id, label: `${humanize(x.payroll_type)} · ${x.branch_name} · ${humanize(x.payroll_status)}` }))} onChange={(e) => e.target.value && onSelect(Number(e.target.value))} />
      )}
      <Select label="Branch view" name="branch" placeholder="All branches" value={branch} options={branches.map(([id, name]) => ({ value: id, label: name }))} onChange={(e) => onBranch(e.target.value)} />
    </div>
  );
}

function WorkingDays({ period, disabled, onSaved }: { period: PayrollPeriod; disabled: boolean; onSaved: () => void }) {
  const [value, setValue] = useState(period.working_days === null ? '' : String(period.working_days));
  const save = useMutation({ mutationFn: () => payrollApi.periods.setWorkingDays(period.id, Number(value)), onSuccess: onSaved });
  const invalid = !/^\d{1,2}$/.test(value) || Number(value) > period.total_days;
  return (
    <form className="flex items-end gap-2" onSubmit={(e) => { e.preventDefault(); if (!invalid) save.mutate(); }}>
      <div className="text-sm"><span className="field-label">Total days</span><span className="block px-1 py-2 tabular-nums">{period.total_days}</span></div>
      <div className="w-28">
        <label htmlFor="working-days" className="field-label">Working days</label>
        <input id="working-days" className="field-input" inputMode="numeric" disabled={disabled} value={value} aria-invalid={value !== '' && invalid} onChange={(e) => setValue(e.target.value)} title="Printed on payslips. It does not affect pay." />
      </div>
      <Button type="submit" variant="secondary" disabled={disabled || invalid || save.isPending || Number(value) === period.working_days}>Save Working Days</Button>
      {value !== '' && invalid && <span className="pb-2 text-xs text-danger-600">0 to {period.total_days}</span>}
      {save.isError && <span role="alert" className="pb-2 text-xs text-danger-600">{errorMessage(save.error)}</span>}
    </form>
  );
}

/** What changed since Prepare, and the errors and warnings, each with the employees it applies to. */
function RunMessages({ run }: { run: PayrollRunGrid }) {
  const groups = useMemo(() => {
    const out = new Map<string, { severity: 'ERROR' | 'WARNING'; message: string; who: string[] }>();
    for (const b of run.bills)
      for (const i of b.issues) {
        const g = out.get(i.severity + i.message) ?? { severity: i.severity, message: i.message, who: [] };
        g.who.push(`${b.employee_code} ${b.employee_name}`);
        out.set(i.severity + i.message, g);
      }
    return [...out.values()];
  }, [run.bills]);
  const of = (s: 'ERROR' | 'WARNING') => groups.filter((g) => g.severity === s);
  const people = (s: 'ERROR' | 'WARNING') => run.bills.filter((b) => b.issues.some((i) => i.severity === s)).length;
  return (
    <>
      {run.changed.length > 0 && (
        <div role="alert" className="rounded-lg bg-danger-50 px-4 py-2 text-sm text-danger-700">
          <p className="flex items-center gap-2 font-semibold"><AlertTriangle size={16} /> Something changed after Prepare: {run.changed.length} pay bill(s) would come out differently. Prepare the payroll again before approval.</p>
          <p className="mt-1">{run.changed.slice(0, 10).map((e) => `${e.employeeCode} ${e.employeeName}`).join(', ')}{run.changed.length > 10 && ` and ${run.changed.length - 10} more`}</p>
        </div>
      )}
      {(['ERROR', 'WARNING'] as const).map((s) =>
        of(s).length === 0 ? null : (
          <details key={s} open={s === 'ERROR'} className={`rounded-lg px-4 py-2 text-sm ${s === 'ERROR' ? 'bg-danger-50 text-danger-700' : 'bg-warning-50 text-warning-700'}`}>
            <summary className="cursor-pointer font-semibold">{s === 'ERROR' ? `Errors for ${people(s)} employee(s): the run cannot be approved` : `Warnings for ${people(s)} employee(s)`}</summary>
            <ul className="mt-2 space-y-1">
              {of(s).map((g) => (
                <li key={g.message}>
                  {g.who.length <= 3 ? <>{g.message} — <span className="font-medium">{g.who.join(', ')}</span></> : (
                    <details><summary className="cursor-pointer">{g.message} — <span className="font-medium">{g.who.length} employees</span></summary><p className="pl-4">{g.who.join(', ')}</p></details>
                  )}
                </li>
              ))}
            </ul>
          </details>
        ),
      )}
    </>
  );
}

function Summary({ summary }: { summary: PayrollRunGrid['summary'] }) {
  return (
    <dl className="card flex flex-wrap gap-x-10 gap-y-2 p-4 text-sm">
      {(['paid', 'pending', 'withheld'] as const).map((k) => (
        <div key={k}>
          <dt className="text-xs font-semibold uppercase tracking-wide text-ink-500">{humanize(k)}</dt>
          <dd className="font-medium text-ink-900">{summary[k].count} bill(s) · {formatINR(summary[k].net)}</dd>
        </div>
      ))}
      <p className="self-end text-xs text-ink-500">All branches. Pending: approved, not withheld, not paid.</p>
    </dl>
  );
}
