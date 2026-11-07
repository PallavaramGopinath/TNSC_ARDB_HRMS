/**
 * Pure employee validation rules — ports of TNCU EmployeeDateRules / EmployeeService checks
 * (TNCU.DTO/HR/EmployeeDtos.cs, TNCU.Business/HR/EmployeeService.cs). No DB access here, so the
 * rules are unit-testable; DB-dependent checks live in employeeService.ts.
 * Dates are 'YYYY-MM-DD' strings, which compare correctly as strings.
 */
import type { EmployeeInput } from '../../models/hr/employee.schema';

export type FieldErrors = Record<string, string[]>;

export interface RuleContext {
  businessDate: string;
  minAgeAtJoining: number;
}

const add = (errs: FieldErrors, field: string, msg: string) => {
  (errs[field] ??= []).push(msg);
};

/** date + n years, clamped like C# DateOnly.AddYears (29 Feb → 28 Feb). */
export function addYears(d: string, n: number): string {
  const [y, m, day] = d.split('-').map(Number) as [number, number, number];
  const ty = y + n;
  const last = new Date(Date.UTC(ty, m, 0)).getUTCDate();
  return `${ty}-${String(m).padStart(2, '0')}-${String(Math.min(day, last)).padStart(2, '0')}`;
}

/** Compassionate-ground appointment: explicit category, or blank category with that recruitment mode. */
export const isCompassionate = (i: Pick<EmployeeInput, 'specialCategory' | 'modeOfRecruitment'>) =>
  i.specialCategory === 'COMPASSIONATE_GROUND' || (!i.specialCategory && i.modeOfRecruitment === 'COMPASSIONATE_GROUND');

export function validateEmployee(i: EmployeeInput, ctx: RuleContext): FieldErrors {
  const e: FieldErrors = {};
  const doj = i.dateOfJoining;
  const today = ctx.businessDate;
  const notFuture = (field: keyof EmployeeInput, v: string | null | undefined, label: string) => {
    if (v && v > today) add(e, field, `${label} cannot be in the future`);
  };

  // Age on joining
  if (i.dateOfBirth) {
    if (i.dateOfBirth >= doj) add(e, 'dateOfBirth', 'Date of birth must be before date of joining');
    else if (addYears(i.dateOfBirth, ctx.minAgeAtJoining) > doj)
      add(e, 'dateOfJoining', `Employee must be at least ${ctx.minAgeAtJoining} years old on the date of joining`);
  }
  notFuture('dateOfJoining', doj, 'Date of joining');

  // Leaving / retirement / confirmation relative to joining
  if (i.dateOfLeaving) {
    if (i.dateOfLeaving < doj) add(e, 'dateOfLeaving', 'Date of leaving cannot be before date of joining');
    notFuture('dateOfLeaving', i.dateOfLeaving, 'Date of leaving');
  }
  if (i.dateOfRetirement && i.dateOfRetirement < doj) add(e, 'dateOfRetirement', 'Date of retirement cannot be before date of joining');
  if (i.dateOfConfirmation && i.dateOfConfirmation < doj) add(e, 'dateOfConfirmation', 'Date of confirmation cannot be before date of joining');

  // Confirmation particulars need a confirmation date
  if (!i.dateOfConfirmation && (i.confirmationOrderNo || i.confirmationOrderDate || i.confirmedAgainstDesignationId))
    add(e, 'dateOfConfirmation', 'Enter the date of confirmation before confirmation order details');
  notFuture('confirmationOrderDate', i.confirmationOrderDate, 'Confirmation order date');

  // Appointment & probation
  notFuture('appointmentOrderDate', i.appointmentOrderDate, 'Appointment order date');
  if (i.probationExtensionMonths) {
    if (!i.probationMonths) add(e, 'probationExtensionMonths', 'Enter the probation period before an extension');
    else if (i.probationMonths + i.probationExtensionMonths > 60)
      add(e, 'probationExtensionMonths', 'Probation plus extension cannot exceed 60 months');
  }
  notFuture('probationExtensionOrderDate', i.probationExtensionOrderDate, 'Extension order date');
  if (i.probationTestPassedOn) {
    if (i.probationTestPassed !== true) add(e, 'probationTestPassedOn', 'A test date needs "Test passed" = Yes');
    if (i.probationTestPassedOn < doj) add(e, 'probationTestPassedOn', 'Test date cannot be before date of joining');
    notFuture('probationTestPassedOn', i.probationTestPassedOn, 'Test date');
  }

  // Special appointment / compassionate ground
  notFuture('specialOrderDate', i.specialOrderDate, 'G.O. date');
  const hasDeceased = !!(i.deceasedEmployeeId || i.deceasedName || i.deceasedDesignation || i.deceasedDateOfDeath || i.deceasedRelationship);
  if (hasDeceased && !isCompassionate(i))
    add(e, 'specialCategory', 'Deceased employee details are allowed only for a compassionate-ground appointment');
  if (i.deceasedDateOfDeath) {
    notFuture('deceasedDateOfDeath', i.deceasedDateOfDeath, 'Date of death');
    if (i.deceasedDateOfDeath > doj) add(e, 'deceasedDateOfDeath', "Date of death must be on or before the appointee's date of joining");
  }

  // Bank / IFSC (prefix match is checked in the service, which knows the bank)
  if (i.ifscCode && !i.bankMasterId) add(e, 'bankMasterId', 'Choose the bank before entering an IFSC');

  return e;
}

export const hasErrors = (e: FieldErrors) => Object.keys(e).length > 0;
