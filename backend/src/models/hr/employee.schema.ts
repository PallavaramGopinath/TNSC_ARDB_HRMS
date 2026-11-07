import { z } from 'zod';
import {
  DeceasedRelationship, EmploymentType, Gender, MaritalStatus, ModeOfRecruitment, SpecialCategory, SponsoredBy,
} from '../enums';

// ---- field helpers: blank → null, trim, optional uppercase -----------------------------------
const blank = (v: unknown) => (v === undefined || v === null || (typeof v === 'string' && v.trim() === '') ? null : v);

const str = (max: number) => z.preprocess(blank, z.string().trim().max(max).nullable()).optional();
const upper = (max: number, re?: RegExp, msg?: string) =>
  z.preprocess((v) => {
    const b = blank(v);
    return typeof b === 'string' ? b.trim().toUpperCase() : b;
  }, (re ? z.string().regex(re, msg) : z.string()).max(max).nullable()).optional();
const date = z.preprocess(blank, z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a valid date').nullable()).optional();
const int = (min: number, max: number) => z.preprocess(blank, z.coerce.number().int().min(min).max(max).nullable()).optional();
const id = z.preprocess(blank, z.coerce.number().int().positive().nullable()).optional();
const en = <T extends readonly [string, ...string[]]>(values: T) => z.preprocess(blank, z.enum(values).nullable()).optional();
const bool = z.preprocess((v) => (v === '' || v === undefined ? null : v === 'true' ? true : v === 'false' ? false : v), z.boolean().nullable()).optional();
const money = z.preprocess(blank, z.coerce.number().min(0, 'Cannot be negative').max(99_99_99_999.99).nullable()).optional();

/** Create / update payload (camelCase; mapped to snake_case columns in the service). */
export const EmployeeInputSchema = z.object({
  // personal
  employeeName: z.string().trim().min(1, 'Employee name is required').max(200),
  employeeNameTamil: str(200),
  gender: en(Gender),
  dateOfBirth: date,
  maritalStatus: en(MaritalStatus),
  bloodGroup: str(10),
  height: z.coerce.number({ invalid_type_error: 'Height is required' }).min(50, 'Height in cm (50–250)').max(250, 'Height in cm (50–250)'),
  weight: z.coerce.number({ invalid_type_error: 'Weight is required' }).min(20, 'Weight in kg (20–250)').max(250, 'Weight in kg (20–250)'),
  // contact
  mobile: z.preprocess(blank, z.string().trim().regex(/^[6-9]\d{9}$/, 'Enter a 10-digit mobile number').nullable()).optional(),
  email: z.preprocess(blank, z.string().trim().email('Enter a valid email').max(100).nullable()).optional(),
  address: str(1000),
  city: str(100),
  district: str(100),
  state: str(100),
  pincode: z.preprocess(blank, z.string().trim().regex(/^\d{6}$/, 'Pincode must be 6 digits').nullable()).optional(),
  // identity & bank
  panNumber: upper(10, /^[A-Z]{5}\d{4}[A-Z]$/, 'PAN format: AAAAA9999A'),
  aadharNumber: z.preprocess((v) => (typeof v === 'string' ? v.replace(/\s/g, '') : v), z.preprocess(blank, z.string().regex(/^\d{12}$/, 'Aadhaar must be 12 digits').nullable())).optional(),
  epfNumber: upper(20),
  bankMasterId: id,
  bankBranch: str(100),
  accountNumber: z.preprocess(blank, z.string().trim().regex(/^\d{6,20}$/, 'Account number: 6–20 digits').nullable()).optional(),
  ifscCode: upper(11, /^[A-Z]{4}0[A-Z0-9]{6}$/, 'IFSC: 4 letters, 0, then 6 letters/digits'),
  // service
  designationId: z.coerce.number({ invalid_type_error: 'Designation is required' }).int().positive('Designation is required'),
  grade: str(50),
  branchId: z.coerce.number({ invalid_type_error: 'Branch is required' }).int().positive('Branch is required'),
  employmentType: en(EmploymentType),
  modeOfRecruitment: en(ModeOfRecruitment),
  dateOfJoining: z.string({ required_error: 'Date of joining is required' }).regex(/^\d{4}-\d{2}-\d{2}$/, 'Date of joining is required'),
  dateOfRetirement: date,
  dateOfLeaving: date,
  incrementMonth: z.coerce.number({ invalid_type_error: 'Increment month is required' }).int().min(1, 'Increment month 1–12').max(12, 'Increment month 1–12'),
  scaleOfPay: str(250),
  basicSalary: money,
  // appointment
  appointmentOrderNo: str(100),
  appointmentOrderDate: date,
  sponsoredBy: en(SponsoredBy),
  probationMonths: int(0, 60),
  appointmentRemarks: str(500),
  // probation
  probationExtensionMonths: int(0, 24),
  probationExtensionOrderNo: str(100),
  probationExtensionOrderDate: date,
  probationTestPassed: bool,
  probationTestPassedOn: date,
  probationRemarks: str(500),
  confirmationDelayReason: str(500),
  // confirmation
  dateOfConfirmation: date,
  confirmationOrderNo: str(100),
  confirmationOrderDate: date,
  confirmedAgainstDesignationId: id,
  confirmationRemarks: str(500),
  // special appointment
  specialCategory: en(SpecialCategory),
  specialOrderNo: str(100),
  specialOrderDate: date,
  deceasedEmployeeId: id,
  deceasedName: str(150),
  deceasedDesignation: str(100),
  deceasedDateOfDeath: date,
  deceasedRelationship: en(DeceasedRelationship),
});
export type EmployeeInput = z.infer<typeof EmployeeInputSchema>;

export const EmployeeQuerySchema = z.object({
  q: z.string().trim().max(100).optional(),
  branchId: z.coerce.number().int().positive().optional(),
  designationId: z.coerce.number().int().positive().optional(),
  status: z.enum(['active', 'left', 'all']).default('active'),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(20),
});
export type EmployeeQuery = z.infer<typeof EmployeeQuerySchema>;
