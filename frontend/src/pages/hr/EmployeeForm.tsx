import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Save } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useForm, type RegisterOptions } from 'react-hook-form';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Button } from '@/components/ui/Button';
import { Field } from '@/components/ui/Field';
import { PageHeader } from '@/components/ui/PageHeader';
import { Grid, Section } from '@/components/ui/Section';
import { Select, enumOptions } from '@/components/ui/Select';
import { TextArea } from '@/components/ui/TextArea';
import { MONTHS } from '@/lib/format';
import { errorMessage, fieldErrors } from '@/services/api';
import { coreApi } from '@/services/core';
import { hrApi } from '@/services/hr';
import type { Employee } from '@/types/api';
import {
  BloodGroups, DeceasedRelationship, EmploymentType, Gender, GenderLabel, MaritalStatus, ModeOfRecruitment, SpecialCategory, SponsoredBy,
} from '@/types/enums';

/** Every form field (camelCase = API payload key; snake_case of it = DB column). */
const FIELDS = [
  'employeeName', 'employeeNameTamil', 'gender', 'dateOfBirth', 'maritalStatus', 'bloodGroup', 'height', 'weight',
  'mobile', 'email', 'address', 'city', 'district', 'state', 'pincode',
  'panNumber', 'aadharNumber', 'epfNumber', 'bankMasterId', 'bankBranch', 'accountNumber', 'ifscCode',
  'designationId', 'grade', 'branchId', 'employmentType', 'modeOfRecruitment', 'dateOfJoining', 'dateOfRetirement', 'dateOfLeaving',
  'incrementMonth', 'scaleOfPay', 'basicSalary',
  'appointmentOrderNo', 'appointmentOrderDate', 'sponsoredBy', 'probationMonths', 'appointmentRemarks',
  'probationExtensionMonths', 'probationExtensionOrderNo', 'probationExtensionOrderDate', 'probationTestPassed', 'probationTestPassedOn',
  'probationRemarks', 'confirmationDelayReason',
  'dateOfConfirmation', 'confirmationOrderNo', 'confirmationOrderDate', 'confirmedAgainstDesignationId', 'confirmationRemarks',
  'specialCategory', 'specialOrderNo', 'specialOrderDate', 'deceasedName', 'deceasedDesignation', 'deceasedDateOfDeath', 'deceasedRelationship',
] as const;
type FieldName = (typeof FIELDS)[number];
type FormValues = Record<FieldName, string>;

const snake = (k: string) => k.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);

function toFormValues(e?: Employee): FormValues {
  const v = {} as FormValues;
  for (const f of FIELDS) {
    const raw = e ? (e as unknown as Record<string, unknown>)[snake(f)] : undefined;
    v[f] = raw === null || raw === undefined ? '' : String(raw);
  }
  if (!e) v.state = 'Tamil Nadu';
  return v;
}

const SECTIONS = [
  ['personal', 'Personal'], ['contact', 'Contact'], ['identity', 'Identity & bank'], ['service', 'Service'],
  ['appointment', 'Appointment'], ['probation', 'Probation'], ['confirmation', 'Confirmation'], ['special', 'Special appointment'],
] as const;

const req = (label: string): RegisterOptions<FormValues> => ({ required: `${label} is required` });

/** Create / edit employee (TNCU /hr/employees form, KYC fields inline — ARDB D12). */
export function EmployeeFormPage() {
  const { id } = useParams();
  const editing = !!id;
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [topError, setTopError] = useState<string | null>(null);

  const existing = useQuery({ queryKey: ['employee', Number(id)], queryFn: () => hrApi.employees.get(Number(id)), enabled: editing });
  const branches = useQuery({ queryKey: ['branches'], queryFn: coreApi.branches, staleTime: 10 * 60_000 });
  const designations = useQuery({ queryKey: ['designations', '', false], queryFn: () => hrApi.designations.list() });
  const banks = useQuery({ queryKey: ['bank-masters', 'lookup'], queryFn: () => hrApi.bankMasters.list({ includeInactive: true }), staleTime: 60_000 });

  const { register, handleSubmit, reset, watch, setError, formState } = useForm<FormValues>({ defaultValues: toFormValues() });
  // Fill only once the dropdown options exist, or the selects can't take their saved values.
  const lookupsReady = !!(branches.data && designations.data && banks.data);
  useEffect(() => {
    if (existing.data && lookupsReady) reset(toFormValues(existing.data));
  }, [existing.data, lookupsReady, reset]);

  const err = (f: FieldName) => formState.errors[f]?.message;
  const specialCategory = watch('specialCategory');
  const mode = watch('modeOfRecruitment');
  const bankId = watch('bankMasterId');
  const compassionate = specialCategory === 'COMPASSIONATE_GROUND' || (!specialCategory && mode === 'COMPASSIONATE_GROUND');
  const bank = banks.data?.find((b) => String(b.id) === bankId);

  const save = useMutation({
    mutationFn: (v: FormValues) => (editing ? hrApi.employees.update(Number(id), v) : hrApi.employees.create(v)),
    onSuccess: (emp) => {
      void qc.invalidateQueries({ queryKey: ['employees'] });
      qc.setQueryData(['employee', emp.id], emp);
      navigate(`/hr/employees/${emp.id}`);
    },
    onError: (e) => {
      const fe = fieldErrors(e);
      if (fe) {
        let mapped = 0;
        for (const [f, msgs] of Object.entries(fe)) {
          if ((FIELDS as readonly string[]).includes(f)) { setError(f as FieldName, { message: msgs[0] }); mapped++; }
        }
        setTopError(`Please correct ${mapped || 'the'} highlighted field${mapped === 1 ? '' : 's'}.`);
      } else setTopError(errorMessage(e));
      window.scrollTo({ top: 0, behavior: 'smooth' });
    },
  });

  if (editing && (existing.isLoading || !lookupsReady)) return <p className="text-ink-400">Loading…</p>;

  // Active banks, plus the employee's saved bank even if it has since been deactivated.
  const bankOptions = (banks.data ?? [])
    .filter((b) => b.is_active || b.id === existing.data?.bank_master_id)
    .map((b) => ({ value: b.id, label: b.is_active ? b.bank_name : `${b.bank_name} (inactive)` }));
  const designationOptions = (designations.data ?? []).map((d) => ({ value: d.id, label: d.designation_name }));

  return (
    <form onSubmit={handleSubmit((v) => {
        setTopError(null);
        // Posting is changed only through Transfers (TNCU); the disabled select is not submitted.
        save.mutate(editing && existing.data ? { ...v, branchId: String(existing.data.branch_id) } : v);
      })} noValidate className="pb-20">
      <Link to={editing ? `/hr/employees/${id}` : '/hr/employees'} className="mb-2 inline-flex items-center gap-1 text-sm text-ink-500 hover:text-ink-800">
        <ArrowLeft size={14} /> {editing ? 'Back to profile' : 'Employees'}
      </Link>
      <PageHeader
        title={editing ? `Edit ${existing.data?.employee_code} · ${existing.data?.employee_name}` : 'New employee'}
        subtitle={editing ? undefined : 'The employee code is generated on save'}
      />

      <nav className="mb-4 flex flex-wrap gap-2" aria-label="Form sections">
        {SECTIONS.map(([k, label]) => (
          <a key={k} href={`#${k}`} className="rounded-full border border-ink-200 bg-white px-3 py-1 text-xs font-semibold text-ink-600 hover:border-brand-300 hover:text-brand-700">{label}</a>
        ))}
      </nav>

      {topError && <p role="alert" className="mb-4 rounded-lg bg-danger-50 px-4 py-3 text-sm text-danger-700">{topError}</p>}

      <div className="space-y-5">
        <Section id="personal" title="Personal">
          <Grid>
            <Field label="Employee name *" {...register('employeeName', req('Employee name'))} error={err('employeeName')} />
            <Field label="Name in Tamil" className="field-input font-tamil" {...register('employeeNameTamil')} error={err('employeeNameTamil')} />
            <Select label="Gender" options={Gender.map((g) => ({ value: g, label: GenderLabel[g] }))} {...register('gender')} error={err('gender')} />
            <Field label="Date of birth" type="date" {...register('dateOfBirth')} error={err('dateOfBirth')} />
            <Select label="Marital status" options={enumOptions(MaritalStatus)} {...register('maritalStatus')} error={err('maritalStatus')} />
            <Select label="Blood group" options={BloodGroups.map((b) => ({ value: b, label: b }))} {...register('bloodGroup')} error={err('bloodGroup')} />
            <Field label="Height (cm) *" type="number" step="0.1" {...register('height', req('Height'))} error={err('height')} />
            <Field label="Weight (kg) *" type="number" step="0.1" {...register('weight', req('Weight'))} error={err('weight')} />
          </Grid>
        </Section>

        <Section id="contact" title="Contact">
          <Grid>
            <Field label="Mobile" inputMode="numeric" maxLength={10} {...register('mobile')} error={err('mobile')} />
            <Field label="Email" type="email" {...register('email')} error={err('email')} />
            <div className="md:col-span-2 xl:col-span-3"><TextArea label="Address" {...register('address')} error={err('address')} /></div>
            <Field label="City" {...register('city')} error={err('city')} />
            <Field label="District" {...register('district')} error={err('district')} />
            <Field label="State" {...register('state')} error={err('state')} />
            <Field label="Pincode" inputMode="numeric" maxLength={6} {...register('pincode')} error={err('pincode')} />
          </Grid>
        </Section>

        <Section id="identity" title="Identity & bank" description="Bank details are used for the salary NEFT file.">
          <Grid>
            <Field label="PAN" maxLength={10} className="field-input uppercase" {...register('panNumber')} error={err('panNumber')} />
            <Field label="Aadhaar" inputMode="numeric" maxLength={14} {...register('aadharNumber')} error={err('aadharNumber')} />
            <Field label="EPF number" className="field-input uppercase" {...register('epfNumber')} error={err('epfNumber')} />
            <Select label="Bank" options={bankOptions} placeholder={banks.data?.length ? 'Select…' : 'No banks in Bank Master yet'} {...register('bankMasterId')} error={err('bankMasterId')} />
            <Field label="Bank branch" {...register('bankBranch')} error={err('bankBranch')} />
            <Field label="Account number" inputMode="numeric" {...register('accountNumber')} error={err('accountNumber')} />
            <div>
              <Field label="IFSC" maxLength={11} className="field-input uppercase" placeholder={bank ? `${bank.ifsc_for_bank}0XXXXXX` : 'Choose a bank first'} readOnly={!bankId} {...register('ifscCode')} error={err('ifscCode')} />
            </div>
          </Grid>
        </Section>

        <Section id="service" title="Service">
          <Grid>
            <Select label="Designation *" options={designationOptions} placeholder={designationOptions.length ? 'Select…' : 'Add designations first'} {...register('designationId', req('Designation'))} error={err('designationId')} />
            <Field label="Grade" {...register('grade')} error={err('grade')} />
            <Select label="Branch (posting) *" options={(branches.data ?? []).map((b) => ({ value: b.id, label: `${b.name} (${b.code})` }))} disabled={editing} {...register('branchId', req('Branch'))} error={err('branchId')} hint={editing ? 'Change the posting through Transfers' : undefined} />
            <Select label="Employment type" options={enumOptions(EmploymentType)} {...register('employmentType')} error={err('employmentType')} />
            <Select label="Mode of recruitment" options={enumOptions(ModeOfRecruitment)} {...register('modeOfRecruitment')} error={err('modeOfRecruitment')} />
            <Field label="Date of joining *" type="date" {...register('dateOfJoining', req('Date of joining'))} error={err('dateOfJoining')} />
            <Field label="Date of retirement" type="date" {...register('dateOfRetirement')} error={err('dateOfRetirement')} />
            <Select label="Increment month *" options={MONTHS.map((m, i) => ({ value: i + 1, label: m }))} {...register('incrementMonth', req('Increment month'))} error={err('incrementMonth')} />
            <Field label="Basic salary (₹)" type="number" step="0.01" min={0} {...register('basicSalary')} error={err('basicSalary')} />
            <div className="md:col-span-2 xl:col-span-3"><Field label="Scale of pay" {...register('scaleOfPay')} error={err('scaleOfPay')} /></div>
            {editing && <Field label="Date of leaving" type="date" {...register('dateOfLeaving')} error={err('dateOfLeaving')} />}
          </Grid>
        </Section>

        <Section id="appointment" title="Appointment">
          <Grid>
            <Field label="Appointment order no." {...register('appointmentOrderNo')} error={err('appointmentOrderNo')} />
            <Field label="Order date" type="date" {...register('appointmentOrderDate')} error={err('appointmentOrderDate')} />
            <Select label="Sponsored by" options={enumOptions(SponsoredBy)} {...register('sponsoredBy')} error={err('sponsoredBy')} />
            <Field label="Probation (months)" type="number" min={0} max={60} {...register('probationMonths')} error={err('probationMonths')} />
            <div className="md:col-span-2"><TextArea label="Remarks" {...register('appointmentRemarks')} error={err('appointmentRemarks')} /></div>
          </Grid>
        </Section>

        <Section id="probation" title="Probation">
          <Grid>
            <Field label="Extension (months)" type="number" min={0} max={24} {...register('probationExtensionMonths')} error={err('probationExtensionMonths')} />
            <Field label="Extension order no." {...register('probationExtensionOrderNo')} error={err('probationExtensionOrderNo')} />
            <Field label="Extension order date" type="date" {...register('probationExtensionOrderDate')} error={err('probationExtensionOrderDate')} />
            <Select label="Probation test passed" options={[{ value: 'true', label: 'Yes' }, { value: 'false', label: 'No' }]} placeholder="Not recorded" {...register('probationTestPassed')} error={err('probationTestPassed')} />
            <Field label="Test passed on" type="date" {...register('probationTestPassedOn')} error={err('probationTestPassedOn')} />
            <div />
            <TextArea label="Probation remarks" {...register('probationRemarks')} error={err('probationRemarks')} />
            <TextArea label="Reason for delayed confirmation" {...register('confirmationDelayReason')} error={err('confirmationDelayReason')} />
          </Grid>
        </Section>

        <Section id="confirmation" title="Confirmation">
          <Grid>
            <Field label="Date of confirmation" type="date" {...register('dateOfConfirmation')} error={err('dateOfConfirmation')} />
            <Field label="Confirmation order no." {...register('confirmationOrderNo')} error={err('confirmationOrderNo')} />
            <Field label="Order date" type="date" {...register('confirmationOrderDate')} error={err('confirmationOrderDate')} />
            <Select label="Confirmed against post" options={designationOptions} {...register('confirmedAgainstDesignationId')} error={err('confirmedAgainstDesignationId')} />
            <div className="md:col-span-2"><TextArea label="Remarks" {...register('confirmationRemarks')} error={err('confirmationRemarks')} /></div>
          </Grid>
        </Section>

        <Section id="special" title="Special appointment" description="Deceased-employee details apply only to compassionate-ground appointments.">
          <Grid>
            <Select label="Category" options={enumOptions(SpecialCategory)} placeholder="None" {...register('specialCategory')} error={err('specialCategory')} />
            <Field label="G.O. / order no." {...register('specialOrderNo')} error={err('specialOrderNo')} />
            <Field label="G.O. date" type="date" {...register('specialOrderDate')} error={err('specialOrderDate')} />
            {compassionate && (
              <>
                <Field label="Deceased employee name" {...register('deceasedName')} error={err('deceasedName')} />
                <Field label="Deceased's designation" {...register('deceasedDesignation')} error={err('deceasedDesignation')} />
                <Field label="Date of death" type="date" {...register('deceasedDateOfDeath')} error={err('deceasedDateOfDeath')} />
                <Select label="Relationship to deceased" options={enumOptions(DeceasedRelationship)} {...register('deceasedRelationship')} error={err('deceasedRelationship')} />
              </>
            )}
          </Grid>
        </Section>
      </div>

      <div className="fixed bottom-0 right-0 left-80 z-10 flex justify-end gap-2 border-t border-ink-200 bg-white/95 px-6 py-3 backdrop-blur">
        <Button variant="secondary" onClick={() => navigate(editing ? `/hr/employees/${id}` : '/hr/employees')}>Cancel</Button>
        <Button type="submit" disabled={save.isPending}><Save size={16} /> {save.isPending ? 'Saving…' : editing ? 'Save changes' : 'Create employee'}</Button>
      </div>
    </form>
  );
}
