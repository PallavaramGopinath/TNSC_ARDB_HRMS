export type ModuleGrant = 'M' | 'C' | 'MC';

export interface AuthUser {
  id: string;
  username: string;
  fullName: string;
  branchId: number;
  branchType: 'HO' | 'BRANCH';
  allBranches: boolean;
  employeeId: number | null;
  isAdmin: boolean;
  mustChangePassword: boolean;
  roles: string[];
  modules: Record<string, ModuleGrant>;
}

export interface TokenPair {
  accessToken: string;
  accessTokenExpiresAt: string;
  refreshToken: string;
  user: AuthUser;
}

export interface MenuForm { id: number; title: string; route: string }
export interface MenuSub { id: number; title: string; icon: string | null; route: string | null; forms: MenuForm[] }
export interface MenuMain { id: number; moduleKey: string; title: string; icon: string | null; subs: MenuSub[] }

export interface ApiErrorBody {
  error: { code: string; message: string; details?: unknown; correlationId?: string };
}

export interface Designation {
  id: number;
  designation_name: string;
  grade: string | null;
  pay_level: string | null;
  seniority_order: number | null;
  is_active: boolean;
  created_by: string;
  created_at: string;
}

export interface Grade {
  id: number;
  grade_code: string;
  description: string | null;
  display_order: number | null;
  is_active: boolean;
  /** Designations (active or not) whose grade matches this code. */
  usage_count: number;
}

export interface PayrollComponent {
  id: number;
  component_name: string;
  component_code: string;
  component_type: 1 | 2 | 3;
  is_da_applicable: boolean;
  is_surrender_leave_applicable: boolean;
  is_income_tax_applicable: boolean;
  display_order: number | null;
  calculation_method: string | null;
  calculation_basis: string | null;
  minimum_amount: string;
  maximum_amount: string;
  is_active: boolean;
  /** Rows in assignments / payroll details / deductions that reference this component. */
  usage_count: number;
  /** Code the payroll calculator depends on — code and type locked, cannot be deactivated or deleted. */
  is_system: boolean;
}

export interface Branch { id: number; code: string; name: string; type: 'HO' | 'BRANCH'; place_id: number | null; is_active: boolean }
export interface PlaceCategory { id: number; code: string; name: string }
export interface BranchMaster {
  id: number;
  code: string;
  name: string;
  type: 'HO' | 'BRANCH';
  address: string | null;
  district: string | null;
  pincode: string | null;
  phone: string | null;
  email: string | null;
  place_id: number | null;
  place_name: string | null;
  is_active: boolean;
  employee_count: number;
  created_by: string;
  created_at: string;
  updated_by: string | null;
  updated_at: string | null;
}
export interface BankMaster {
  id: number;
  bank_name: string;
  ifsc_for_bank: string;
  is_active: boolean;
  employee_count: number;
  created_by: string;
  created_at: string;
  updated_by: string | null;
  updated_at: string | null;
}

export interface EmployeeListItem {
  id: number;
  employee_code: string;
  employee_name: string;
  gender: string | null;
  mobile: string | null;
  date_of_joining: string | null;
  date_of_retirement: string | null;
  date_of_leaving: string | null;
  basic_salary: string;
  epf_number: string | null;
  branch_id: number;
  branch_name: string;
  designation_id: number;
  designation_name: string;
}

export interface Paged<T> { items: T[]; total: number; page: number; pageSize: number }

/** Full employee row (snake_case, as stored) + joined names. */
export interface Employee {
  id: number;
  employee_code: string;
  employee_name: string;
  employee_name_tamil: string | null;
  gender: string | null;
  date_of_birth: string | null;
  marital_status: string | null;
  blood_group: string | null;
  height: string | null;
  weight: string | null;
  mobile: string | null;
  email: string | null;
  address: string | null;
  city: string | null;
  district: string | null;
  state: string | null;
  pincode: string | null;
  pan_number: string | null;
  aadhar_number: string | null;
  epf_number: string | null;
  bank_master_id: number | null;
  bank_name: string | null;
  bank_branch: string | null;
  account_number: string | null;
  ifsc_code: string | null;
  designation_id: number;
  designation_name: string;
  seniority_order: number | null;
  grade: string | null;
  branch_id: number;
  branch_name: string;
  employment_type: string | null;
  mode_of_recruitment: string | null;
  date_of_joining: string | null;
  date_of_retirement: string | null;
  date_of_leaving: string | null;
  increment_month: number;
  scale_of_pay: string | null;
  basic_salary: string;
  appointment_order_no: string | null;
  appointment_order_date: string | null;
  sponsored_by: string | null;
  probation_months: number | null;
  appointment_remarks: string | null;
  probation_extension_months: number | null;
  probation_extension_order_no: string | null;
  probation_extension_order_date: string | null;
  probation_test_passed: boolean | null;
  probation_test_passed_on: string | null;
  probation_remarks: string | null;
  confirmation_delay_reason: string | null;
  date_of_confirmation: string | null;
  confirmation_order_no: string | null;
  confirmation_order_date: string | null;
  confirmed_against_designation_id: number | null;
  confirmed_against_designation_name: string | null;
  confirmation_remarks: string | null;
  special_category: string | null;
  special_order_no: string | null;
  special_order_date: string | null;
  deceased_employee_id: number | null;
  deceased_name: string | null;
  deceased_designation: string | null;
  deceased_date_of_death: string | null;
  deceased_relationship: string | null;
  created_by: string;
  created_at: string;
  updated_by: string | null;
  updated_at: string | null;
}

export interface ServiceHistoryRow {
  id: number;
  effective_date: string;
  service_event: string;
  basic_pay: string | null;
  branch_name: string | null;
  designation_name: string | null;
  leave_type: string | null;
  leave_no_of_days: number | null;
  remarks: string | null;
  created_by: string;
  checked_by: string | null;
}

export interface LeaveType {
  id: number;
  leave_name: string;
  leave_code: string | null;
  annual_quota: string;
  carry_forward: boolean;
  encashment_allowed: boolean;
  pay_cut_factor: string;
  cuts_special_pay_and_da: boolean;
  affects_leave_balance: boolean;
  is_active: boolean;
  usage_count: number;
  is_system: boolean;
}

/** Effective-dated % rate (DA or PF) as returned by /payroll/rates/{da,pf}. */
export interface EffectiveRate {
  id: number;
  effective_from: string;
  effective_to: string | null;
  percentage: string;
  is_active: boolean;
  created_by: string;
  created_at: string;
  approved_by: string | null;
  approved_at: string | null;
}

export type PeriodStatus = 'OPEN' | 'PROCESSED' | 'APPROVED' | 'LOCKED';

export interface PayrollPeriod {
  id: number;
  month: number;
  calendar_year: number;
  from_date: string;
  to_date: string;
  payroll_status: PeriodStatus;
  payroll_type: string;
  da_rate: string;
  arrear_from_date: string | null;
  arrear_to_date: string | null;
  working_days: number | null;
  total_days: number;
  branch_id: number;
  branch_name: string;
  branch_code: string;
  financial_year_id: number;
  fy_short_code: string;
  bill_count: number;
  unpaid_count: number;
  created_by: string;
  processed_by: string | null;
  processed_at: string | null;
  approved_by: string | null;
  approved_at: string | null;
  locked_by: string | null;
  locked_at: string | null;
  /** Last reject or reversed approval; cleared by the next Prepare. */
  returned_by: string | null;
  returned_at: string | null;
  return_reason: string | null;
}

// ---------------------------------------------------------------- Payroll Preparation (specs/08)
export interface BillIssue { code: string; severity: 'ERROR' | 'WARNING'; message: string }
export type BillStatus = 'DRAFT' | 'APPROVED' | 'PAID';
export type BillColumn =
  | 'basic' | 'pp' | 'gp' | 'sp' | 'pay' | 'da' | 'hra' | 'cca' | 'ma' | 'employerPf' | 'otherEarnings' | 'pf' | 'vpf' | 'otherDeductions';

interface PayBillHeader {
  id: number;
  employee_id: number;
  employee_code: string;
  employee_name: string;
  designation_name: string;
  branch_id: number;
  branch_name: string;
  working_days: string;
  service_days: string | null;
  payable_days: string;
  gross_earnings: string;
  total_deductions: string;
  net_salary: string;
  payroll_status: BillStatus;
  is_withheld: boolean;
  withhold_reason: string | null;
  issues: BillIssue[];
}
export interface PayBill extends PayBillHeader { amounts: Record<BillColumn, string> }
export interface PayBillDetail extends PayBillHeader {
  lines: Array<{ id: number; component_code: string; component_name: string; allowance_amount: string; deduction_amount: string }>;
}
export interface PayrollRunGrid {
  period: PayrollPeriod;
  bills: PayBill[];
  changed: Array<{ employeeId: number; employeeCode: string; employeeName: string }>;
  summary: Record<'paid' | 'pending' | 'withheld', { count: number; net: string }>;
}
export interface PrepareResult { bills: number; lines: number; errors: number; warnings: number }

export interface PayrollReadiness {
  attendance: { status: 'NOT_UPLOADED' | 'PARTIAL' | 'UPLOADED'; entered: number; total: number; firstUploadedAt: string | null };
  agencies: Array<{ componentId: number; code: string; name: string; uploaded: number; eligible: number; amount: string; employees: number; firstUploadedAt: string | null }>;
  message: string;
}

export interface PeriodAttendanceRow {
  employeeId: number;
  employeeCode: string;
  employeeName: string;
  branch: string;
  serviceDays: number;
  saved: boolean;
  headQuarters: number;
  camp: number;
  remarks: string;
  leaves: Record<number, number>;
}
export interface PeriodAttendance {
  editable: boolean;
  totalDays: number;
  leaveTypes: Array<{ id: number; code: string; name: string; payCutFactor: string; cutsSpecialPayAndDa: boolean }>;
  rows: PeriodAttendanceRow[];
}
export type ImportAction = 'NEW' | 'OVERWRITE' | 'REMOVE' | 'UNCHANGED';
interface ImportRow { line: number; code: string; name: string; action: ImportAction | null; error: string | null }
export interface ImportResult<R extends ImportRow = ImportRow> {
  total: number;
  added: number;
  overwritten: number;
  removed: number;
  unchanged: number;
  errors: number;
  imported: number;
  rows: R[];
}
export type AttendanceSheetImport = ImportResult;
export type DeductionSheetImport = ImportResult<ImportRow & { previous: string | null; amount: string | null; assigned: string | null; waived: boolean }>;

export interface PeriodDeductionRow {
  employeeId: number;
  employeeCode: string;
  employeeName: string;
  branch: string;
  componentId: number;
  componentCode: string;
  componentName: string;
  assigned: string;
  /** null = no entry: the assigned amount applies. 0 = waived. */
  amount: string | null;
  remarks: string;
  previous: string | null;
}
export interface PeriodDeductions {
  editable: boolean;
  period: { month: number; calendarYear: number };
  components: Array<{ id: number; code: string; name: string }>;
  rows: PeriodDeductionRow[];
}

export interface ManualDeductions {
  editable: boolean;
  employeeCode: string;
  employeeName: string;
  branch: string;
  gross: string;
  net: string;
  minimumNet: string;
  minNetPercent: string;
  rows: Array<{ componentId: number; componentCode: string; componentName: string; calculated: string | null; override: string | null; remarks: string; applies: boolean }>;
}

// ---------------------------------------------------------------- HRA & CCA rates (specs/01)
/** Key of a percentage rate row. */
export type HraCcaBasis = 'PLACE' | 'DESIGNATION';
/** How HRA is worked out. CCA always goes by place. */
export type HraMethod = HraCcaBasis | 'FIXED_AMOUNT';
export type HraCcaStatus = 'CURRENT' | 'FUTURE' | 'EXPIRED' | 'INACTIVE';

export interface HraCcaRate {
  id: number;
  rate_basis: HraCcaBasis;
  place_id: number | null;
  designation_id: number | null;
  key_name: string;
  effective_from: string;
  effective_to: string | null;
  hra_percentage: string;
  hra_minimum_amount: string;
  hra_maximum_amount: string;
  cca_percentage: string;
  cca_minimum_amount: string;
  cca_maximum_amount: string;
  remarks: string | null;
  is_active: boolean;
  created_by: string;
  created_at: string;
  updated_by: string | null;
  updated_at: string | null;
  status: HraCcaStatus;
}

export interface HraCcaRateDetail extends HraCcaRate {
  usedInFinalisedPayroll: boolean;
  readOnly: boolean;
  warnings?: string[];
}

export interface HraCcaRateList {
  basis: HraCcaBasis;
  method: HraMethod;
  readOnly: boolean;
  asOn: string;
  page: number;
  size: number;
  total: number;
  items: HraCcaRate[];
}

export interface HraCcaBasisStatus {
  method: HraMethod;
  methodFrom: string | null;
  todayMethod: HraMethod;
  effectiveFrom: string;
  canChange: boolean;
  blockedReason: string | null;
  /** Unapproved runs with pay bills (e.g. "Nov 2026"): prepare them again after a change. */
  reprepare: string[];
  rateCounts: Record<HraMethod, number>;
  lastChangedBy: string | null;
  lastChangedAt: string | null;
}

export interface RateCoverage {
  keysWithEmployees: number;
  missing: Array<{ keyId: number | null; keyName: string; employeeCount: number }>;
}
export interface HraCcaCoverage {
  method: HraMethod;
  asOn: string;
  hra: RateCoverage;
  cca: RateCoverage;
}

export interface HraAmount {
  id: number;
  designation_id: number;
  designation_name: string;
  gcc_amount: string;
  other_amount: string;
  effective_from: string;
  effective_to: string | null;
  remarks: string | null;
  is_active: boolean;
  created_by: string;
  created_at: string;
  updated_by: string | null;
  updated_at: string | null;
  status: HraCcaStatus;
}
export interface HraAmountDetail extends HraAmount {
  usedInFinalisedPayroll: boolean;
  warnings?: string[];
}

export type AssignedType = 'FIXED' | 'PERCENTAGE';
export interface ComponentAssignment {
  id: number;
  employee_id: number;
  employee_code: string;
  employee_name: string;
  designation_name: string;
  component_id: number;
  component_code: string;
  component_name: string;
  component_type: 1 | 2 | 3;
  assigned_type: AssignedType;
  assigned_amount: string;
  percentage: string;
  minimum_amount: string;
  maximum_amount: string;
  /** Null on rows loaded from elsewhere: always in force. */
  effective_from: string | null;
  effective_to: string | null;
  is_active: boolean;
  created_by: string;
  created_at: string;
  status: HraCcaStatus;
}
export interface ComponentAssignmentDetail extends ComponentAssignment {
  usedInFinalisedPayroll: boolean;
  warnings?: string[];
}
export interface ComponentAssignmentList {
  asOn: string;
  page: number;
  size: number;
  total: number;
  items: ComponentAssignment[];
}

export interface AllowanceIssue {
  code: 'BASIC_PAY' | 'DA_RATE' | 'HRA' | 'CCA' | 'MA' | 'PART_MONTH';
  severity: 'ERROR' | 'WARNING';
  message: string;
}
/** Amounts are null while something they need is missing. */
export interface AllowancePreviewRow {
  employeeId: number;
  employeeCode: string | null;
  employeeName: string;
  designation: string;
  branch: string;
  place: string | null;
  basic: string;
  pp: string;
  gp: string;
  basicPay: string;
  da: string | null;
  hra: string | null;
  cca: string | null;
  ma: string | null;
  total: string | null;
  issues: AllowanceIssue[];
}
export interface AllowancePreview {
  period: { id: number; month: number; calendarYear: number; fromDate: string; toDate: string; status: string };
  method: HraMethod;
  daRate: { id: number; percentage: string; effectiveFrom: string } | null;
  medicalAmount: string | null;
  employeeCount: number;
  employeesWithErrors: number;
  ready: boolean;
  employees: AllowancePreviewRow[];
}

// ---------------------------------------------------------------- HR › Attendance
export type AttendanceStatus = 'PRESENT' | 'ABSENT' | 'LEAVE' | 'HOLIDAY' | 'HALF_DAY';

export interface AttendanceDay { date: string; day: number; weekday: number; locked: boolean }

export interface AttendanceEmployee {
  id: number;
  employee_code: string;
  employee_name: string;
  designation_name: string;
  date_of_joining: string | null;
  date_of_leaving: string | null;
  branch_id: number;
}

export interface AttendanceMonth {
  branch: { id: number; code: string; name: string };
  year: number;
  month: number;
  today: string;
  days: AttendanceDay[];
  lockedReason: string | null;
  employees: AttendanceEmployee[];
  records: Record<number, Record<string, { status: AttendanceStatus; remarks: string | null; branchId: number }>>;
}

export interface AttendanceImportRow { line: number; code: string; date: string; status: string }

export interface AttendanceImportResult {
  total: number;
  valid: number;
  imported: number;
  /** Marks equal to what is already saved — skipped. */
  unchanged: number;
  errors: Array<{ line: number; code: string; date: string; message: string }>;
}
