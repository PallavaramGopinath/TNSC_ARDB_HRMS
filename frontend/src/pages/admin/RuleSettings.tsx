import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { PageHeader } from '@/components/ui/PageHeader';
import { Section } from '@/components/ui/Section';
import { useAuth } from '@/hooks/useAuth';
import { formatDate, MONTHS } from '@/lib/format';
import { errorMessage } from '@/services/api';
import { payrollApi } from '@/services/payroll';
import type { HraCcaBasis } from '@/types/api';

/** Administration › Rule Settings. Organisation-level payroll rules (ARDB D9). */
export function RuleSettingsPage() {
  return (
    <>
      <PageHeader title="Rule Settings" subtitle="Organisation-level rules used by HR and Payroll" />
      <div className="max-w-3xl space-y-6">
        <HraCcaBasisCard />
      </div>
    </>
  );
}

const OPTIONS: Array<{ value: HraCcaBasis; label: string; help: string }> = [
  { value: 'PLACE', label: 'Place of posting (Branch)', help: "Rate is taken from the place category of the employee's branch." },
  { value: 'DESIGNATION', label: 'Designation', help: "Rate is taken from the employee's designation." },
];
const label = (b: HraCcaBasis) => OPTIONS.find((o) => o.value === b)!.label;
const monthOf = (d: string) => `${MONTHS[Number(d.slice(5, 7)) - 1]!.slice(0, 3)} ${d.slice(0, 4)}`;

/** HRA & CCA Calculation Basis (specs/01 §5.1). Change: Admin only; blocked while a payroll run is open. */
export function HraCcaBasisCard() {
  const qc = useQueryClient();
  const { user } = useAuth();
  const status = useQuery({ queryKey: ['hra-cca-basis'], queryFn: payrollApi.hraCcaBasis.status });
  const [choice, setChoice] = useState<HraCcaBasis | null>(null);
  const [confirming, setConfirming] = useState(false);
  useEffect(() => { if (status.data) setChoice(status.data.basis); }, [status.data]);

  const s = status.data;
  const canEdit = !!user?.isAdmin && !!s?.canChange;
  const dirty = !!s && choice !== null && choice !== s.basis;

  const coverage = useQuery({
    queryKey: ['hra-cca-coverage', choice, s?.effectiveFrom],
    queryFn: () => payrollApi.hraCcaBasis.coverage(choice!, s!.effectiveFrom),
    enabled: confirming && dirty,
  });

  const save = useMutation({
    mutationFn: () => payrollApi.hraCcaBasis.change(choice!),
    onSuccess: () => {
      setConfirming(false);
      void qc.invalidateQueries({ queryKey: ['hra-cca-basis'] });
      void qc.invalidateQueries({ queryKey: ['hra-cca-rates'] });
      void qc.invalidateQueries({ queryKey: ['hra-cca-missing'] });
    },
  });

  return (
    <Section title="HRA & CCA Calculation Basis" description="How should HRA and CCA percentages be determined?">
      {status.isLoading || !s ? (
        <p className="text-sm text-ink-400">Loading…</p>
      ) : (
        <>
          {!s.canChange && (
            <p role="status" className="mb-4 rounded-lg bg-warning-50 px-3 py-2 text-sm text-warning-700">{s.blockedReason}</p>
          )}
          <fieldset disabled={!canEdit} className="space-y-3">
            <legend className="sr-only">Calculation basis</legend>
            {OPTIONS.map((o) => (
              <label key={o.value} className="flex cursor-pointer items-start gap-3 rounded-lg border border-ink-200 p-3 has-[:checked]:border-brand-400 has-[:checked]:bg-brand-25 has-[:disabled]:cursor-not-allowed">
                <input type="radio" name="hraCcaBasis" className="mt-1 accent-brand-600" value={o.value} checked={choice === o.value} onChange={() => setChoice(o.value)} />
                <span>
                  <span className="block text-sm font-semibold text-ink-900">{o.label}</span>
                  <span className="block text-sm text-ink-500">{o.help}</span>
                </span>
              </label>
            ))}
          </fieldset>
          <dl className="mt-4 grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
            <div><dt className="inline text-ink-500">Applies from payroll period: </dt><dd className="inline font-medium">{monthOf(s.effectiveFrom)} (next to be processed)</dd></div>
            <div><dt className="inline text-ink-500">Rates configured: </dt><dd className="inline font-medium">Place – {s.rateCounts.PLACE} | Designation – {s.rateCounts.DESIGNATION}</dd></div>
            {s.lastChangedBy && s.lastChangedAt && (
              <div className="sm:col-span-2"><dt className="inline text-ink-500">Last changed: </dt><dd className="inline">{new Date(s.lastChangedAt).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })} by {s.lastChangedBy}</dd></div>
            )}
            {s.todayBasis !== s.basis && (
              <div className="sm:col-span-2 text-ink-600">Payroll before {formatDate(s.effectiveFrom)} still uses {label(s.todayBasis)}.</div>
            )}
          </dl>
          {!user?.isAdmin && <p className="mt-3 text-xs text-ink-500">Only an administrator can change the basis.</p>}
          {user?.isAdmin && (
            <div className="mt-5 flex justify-end gap-2">
              <Button variant="secondary" disabled={!dirty} onClick={() => setChoice(s.basis)}>Cancel</Button>
              <Button disabled={!dirty || !canEdit} onClick={() => { save.reset(); setConfirming(true); }}>Save</Button>
            </div>
          )}
        </>
      )}

      {confirming && s && choice && (
        <Modal open title="Change HRA & CCA basis?" onClose={() => setConfirming(false)}>
          <div className="space-y-3 text-sm text-ink-700">
            <p>HRA and CCA will be calculated by <b>{label(choice)}</b> from the <b>{monthOf(s.effectiveFrom)}</b> payroll ({formatDate(s.effectiveFrom)}). Finalised periods are not recalculated.</p>
            {coverage.isLoading ? (
              <p className="text-ink-400">Checking rate coverage…</p>
            ) : coverage.data && coverage.data.missing.length > 0 ? (
              <div className="rounded-lg bg-warning-50 px-3 py-2 text-warning-700">
                Under {label(choice)} basis, {coverage.data.missing.length} of {coverage.data.keysWithEmployees} {choice === 'PLACE' ? 'places' : 'designations'} with active employees have no current rate:{' '}
                {coverage.data.missing.slice(0, 5).map((m) => m.keyName).join(', ')}{coverage.data.missing.length > 5 && ', …'}.{' '}
                <Link to="/payroll/rates/hra-cca" className="font-semibold underline">Configure rates</Link>
              </div>
            ) : coverage.data ? (
              <p className="rounded-lg bg-success-50 px-3 py-2 text-success-700">Every {choice === 'PLACE' ? 'place' : 'designation'} with active employees has a rate.</p>
            ) : null}
            <p className="text-xs text-ink-500">Existing rates of the previous basis will be kept but not used.</p>
            {save.isError && <p role="alert" className="rounded-lg bg-danger-50 px-3 py-2 text-danger-700">{errorMessage(save.error)}</p>}
          </div>
          <div className="mt-5 flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setConfirming(false)}>Cancel</Button>
            <Button disabled={save.isPending} onClick={() => save.mutate()}>{save.isPending ? 'Saving…' : 'Confirm change'}</Button>
          </div>
        </Modal>
      )}
    </Section>
  );
}
