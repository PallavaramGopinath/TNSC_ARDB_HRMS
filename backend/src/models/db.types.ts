/**
 * Kysely table types.
 *
 * Hand-written for the tables the baseline uses. Once the database exists, run
 * `npm run db:codegen` to generate `db.generated.ts` for every table in database/schema.sql;
 * extend `Database` with the generated interfaces as each module is implemented.
 *
 * Conventions: numeric → string (exact money), date → 'YYYY-MM-DD' string, timestamptz → Date.
 */
import type { ColumnType, Generated, Insertable, Selectable, Updateable } from 'kysely';

type Timestamp = ColumnType<Date, Date | string | undefined, Date | string>;
type Numeric = ColumnType<string, string | number, string | number>;
type DateStr = string;

// ---------------------------------------------------------------- core
export interface PlaceCategoryTable {
  id: Generated<number>;
  code: string;
  name: string;
  description: string | null;
  display_order: Generated<number>;
  is_active: Generated<boolean>;
  created_by: string;
  created_at: Generated<Timestamp>;
  updated_by: string | null;
  updated_at: Timestamp | null;
}

export interface BranchTable {
  id: Generated<number>;
  code: string;
  name: string;
  type: 'HO' | 'BRANCH';
  address: string | null;
  district: string | null;
  pincode: string | null;
  phone: string | null;
  email: string | null;
  place_id: number | null;
  is_active: Generated<boolean>;
  created_by: string;
  created_at: Generated<Timestamp>;
  updated_by: string | null;
  updated_at: Timestamp | null;
}

export interface FinancialYearTable {
  id: Generated<number>;
  year_code: string;
  short_code: string;
  start_date: DateStr;
  end_date: DateStr;
  is_closed: Generated<boolean>;
  is_current: Generated<boolean>;
  created_by: string;
  created_at: Generated<Timestamp>;
}

export interface AppSettingTable {
  id: Generated<number>;
  module: string;
  key: string;
  value: ColumnType<unknown, string, string>; // jsonb; write JSON.stringify(value)
  description: string | null;
  effective_from: Generated<DateStr>;
  effective_to: DateStr | null;
  created_by: string;
  created_at: Generated<Timestamp>;
  updated_by: string | null;
  updated_at: Timestamp | null;
}

export type BranchCode = 'HO' | 'BRANCH' | 'ALL';

export interface MenuMainTable {
  id: number;
  module_key: string;
  title: string;
  icon: string | null;
  branch_code: BranchCode;
  required_role: string | null;
  display_order: number;
  is_active: boolean;
}

export interface MenuSubTable {
  id: number;
  main_id: number;
  title: string;
  route: string | null;
  icon: string | null;
  branch_code: BranchCode;
  display_order: number;
  is_active: boolean;
}

export interface MenuFormTable {
  id: number;
  sub_id: number;
  title: string;
  route: string;
  branch_code: BranchCode;
  display_order: number;
  is_active: boolean;
}

// ---------------------------------------------------------------- auth
export interface UserTable {
  id: Generated<string>;
  username: string;
  email: string | null;
  full_name: string;
  password_hash: string;
  is_admin: Generated<boolean>;
  branch_id: number;
  can_view_all_branches: Generated<boolean>;
  employee_id: number | null;
  designation_id: number | null;
  must_change_password: Generated<boolean>;
  is_active: Generated<boolean>;
  access_failed_count: Generated<number>;
  lockout_end: Timestamp | null;
  last_login_at: Timestamp | null;
  created_by: string;
  created_at: Generated<Timestamp>;
  updated_by: string | null;
  updated_at: Timestamp | null;
}

export interface UserModuleTable {
  user_id: string;
  menu_id: number;
  is_maker: boolean;
  is_checker: boolean;
  granted_by: string;
  granted_at: Generated<Timestamp>;
}

export interface RefreshTokenTable {
  id: Generated<number>;
  user_id: string;
  token_hash: string;
  expires_at: Timestamp;
  created_at: Generated<Timestamp>;
  created_ip: string | null;
  revoked_at: Timestamp | null;
  replaced_by: number | null;
}

// ---------------------------------------------------------------- audit
export interface ActivityLogTable {
  id: Generated<number>;
  occurred_at: Generated<Timestamp>;
  category: 'DATA_CHANGE' | 'SECURITY' | 'APPROVAL' | 'ACCESS';
  event_type: string;
  module: string | null;
  entity: string | null;
  entity_id: string | null;
  summary: string | null;
  details: ColumnType<unknown, string | null, string | null> | null;
  user_id: string | null;
  user_name: string | null;
  branch_id: number | null;
  ip_address: string | null;
  user_agent: string | null;
  http_method: string | null;
  route: string | null;
  correlation_id: string | null;
}

// ---------------------------------------------------------------- hr
export interface EmployeeDesignationTable {
  id: Generated<number>;
  designation_name: string;
  grade: string | null;
  pay_level: string | null;
  seniority_order: number | null;
  is_active: Generated<boolean>;
  created_by: string;
  created_at: Generated<Timestamp>;
  updated_by: string | null;
  updated_at: Timestamp | null;
}

export interface EmployeeLeaveTypeTable {
  id: Generated<number>;
  leave_name: string;
  leave_code: string | null;
  annual_quota: Numeric;
  carry_forward: Generated<boolean>;
  encashment_allowed: Generated<boolean>;
  pay_cut_factor: Numeric;
  cuts_special_pay_and_da: Generated<boolean>;
  affects_leave_balance: Generated<boolean>;
  is_active: Generated<boolean>;
  created_by: Generated<string>;
  created_at: Generated<Timestamp>;
}

export interface BankMasterTable {
  id: Generated<number>;
  bank_name: string;
  ifsc_for_bank: string;
  is_active: Generated<boolean>;
  created_by: string;
  created_at: Generated<Timestamp>;
  updated_by: string | null;
  updated_at: Timestamp | null;
}

/** hr.employees after migration 0002 (KYC fields live on the employee — ARDB D12). */
export interface EmployeeTable {
  id: Generated<number>;
  employee_code: string;
  employee_name: string;
  employee_name_tamil: string | null;
  gender: string | null;
  mobile: string | null;
  email: string | null;
  address: string | null;
  city: string | null;
  district: string | null;
  state: string | null;
  pincode: string | null;
  pan_number: string | null;
  aadhar_number: string | null;
  bank_master_id: number | null;
  bank_branch: string | null;
  account_number: string | null;
  ifsc_code: string | null;
  designation_id: number;
  designation: string | null;
  grade: string | null;
  increment_month: number;
  marital_status: string | null;
  height: Numeric;
  weight: Numeric;
  blood_group: string | null;
  scale_of_pay: string | null;
  branch_id: number;
  date_of_birth: DateStr | null;
  date_of_joining: DateStr | null;
  date_of_leaving: DateStr | null;
  date_of_retirement: DateStr | null;
  employment_type: string | null;
  mode_of_recruitment: string | null;
  date_of_confirmation: DateStr | null;
  basic_salary: Numeric;
  epf_number: string | null;
  appointment_order_no: string | null;
  appointment_order_date: DateStr | null;
  probation_months: number | null;
  sponsored_by: string | null;
  appointment_remarks: string | null;
  probation_extension_months: number | null;
  probation_extension_order_no: string | null;
  probation_extension_order_date: DateStr | null;
  probation_test_passed: boolean | null;
  probation_test_passed_on: DateStr | null;
  probation_remarks: string | null;
  confirmation_delay_reason: string | null;
  confirmation_order_no: string | null;
  confirmation_order_date: DateStr | null;
  confirmed_against_designation_id: number | null;
  confirmation_remarks: string | null;
  special_category: string | null;
  special_order_no: string | null;
  special_order_date: DateStr | null;
  deceased_employee_id: number | null;
  deceased_name: string | null;
  deceased_designation: string | null;
  deceased_date_of_death: DateStr | null;
  deceased_relationship: string | null;
  created_by: string;
  created_at: Generated<Timestamp>;
  updated_by: string | null;
  updated_at: Timestamp | null;
}

export interface EmployeeServiceHistoryTable {
  id: Generated<number>;
  employee_id: number;
  effective_date: DateStr;
  branch_id: number | null;
  designation_id: number | null;
  basic_pay: Numeric | null;
  service_event: string;
  leave_type: string | null;
  leave_from_date: DateStr | null;
  leave_to_date: DateStr | null;
  leave_no_of_days: number | null;
  remarks: string | null;
  created_by: string;
  created_at: Generated<Timestamp>;
  checked_by: string | null;
}

export interface EmployeeRetirementTable {
  id: Generated<number>;
  employee_id: number;
  retirement_date: DateStr;
  retirement_mode: string;
  is_active: Generated<boolean>;
}

/** Only the columns the HRA/CCA resolver reads (posting / designation as on a date). */
export interface EmployeeTransferTable {
  id: Generated<number>;
  employee_id: number;
  from_branch_id: number;
  to_branch_id: number;
  joining_date: DateStr | null;
  is_active: Generated<boolean>;
}

export interface EmployeePromotionTable {
  id: Generated<number>;
  employee_id: number;
  promotion_date: DateStr;
  effect_date: DateStr | null;
  status: string;
  from_designation_id: number;
  to_designation_id: number;
}

export interface PayrollDaRateTable {
  id: Generated<number>;
  effective_from: DateStr;
  effective_to: DateStr | null;
  da_percentage: Numeric;
  is_active: Generated<boolean>;
  created_by: string;
  created_at: Generated<Timestamp>;
  approved_by: string | null;
  approved_at: Timestamp | null;
}

export interface PayrollPfDeductionRateTable {
  id: Generated<number>;
  effective_from: DateStr;
  effective_to: DateStr | null;
  pf_deduction_percentage: Numeric;
  is_active: Generated<boolean>;
  created_by: string;
  created_at: Generated<Timestamp>;
  approved_by: string | null;
  approved_at: Timestamp | null;
}

export type HraCcaBasis = 'PLACE' | 'DESIGNATION';

export interface PayrollHraCcaRateTable {
  id: Generated<number>;
  rate_basis: Generated<HraCcaBasis>;
  place_id: number | null;
  designation_id: number | null;
  effective_from: DateStr;
  effective_to: DateStr | null;
  hra_percentage: Numeric;
  hra_minimum_amount: Numeric;
  hra_maximum_amount: Numeric;
  cca_percentage: Numeric;
  cca_minimum_amount: Numeric;
  cca_maximum_amount: Numeric;
  remarks: string | null;
  is_active: Generated<boolean>;
  created_by: string;
  created_at: Generated<Timestamp>;
  updated_by: string | null;
  updated_at: Timestamp | null;
}

export interface PayrollPeriodTable {
  id: Generated<number>;
  month: number;
  calendar_year: number;
  from_date: DateStr;
  to_date: DateStr;
  payroll_status: Generated<string>;
  payroll_type: Generated<string>;
  da_rate: Numeric;
  arrear_from_date: DateStr | null;
  arrear_to_date: DateStr | null;
  working_days: number | null;
  is_active: Generated<boolean>;
  branch_id: number;
  financial_year_id: number;
  created_by: string;
  created_at: Generated<Timestamp>;
  processed_by: string | null;
  processed_at: Timestamp | null;
  approved_by: string | null;
  approved_at: Timestamp | null;
  locked_by: string | null;
  locked_at: Timestamp | null;
}

export interface PayrollTable {
  id: Generated<number>;
  payroll_period_id: number;
  employee_id: number;
  payroll_status: string;
  is_withheld: Generated<boolean>;
}

// ---------------------------------------------------------------- payroll
export interface PayrollComponentTable {
  id: Generated<number>;
  component_name: string;
  component_code: string;
  component_type: 1 | 2 | 3;
  is_da_applicable: Generated<boolean>;
  is_surrender_leave_applicable: Generated<boolean>;
  is_income_tax_applicable: Generated<boolean>;
  display_order: number | null;
  calculation_method: string | null;
  calculation_basis: string | null;
  minimum_amount: Numeric;
  maximum_amount: Numeric;
  is_active: Generated<boolean>;
  created_by: string;
  created_at: Generated<Timestamp>;
  checked_by: string | null;
  checked_at: Timestamp | null;
}

/** hr.employee_attendances — daily attendance, UNIQUE(employee_id, attendance_date). */
export interface EmployeeAttendanceTable {
  id: Generated<number>;
  employee_id: number;
  attendance_date: DateStr;
  in_time: string | null;
  out_time: string | null;
  attendance_status: string;
  remarks: string | null;
  branch_id: number;
  financial_year_id: number | null;
  created_by: string;
  created_at: Generated<Timestamp>;
}

export interface Database {
  'core.place_categories': PlaceCategoryTable;
  'core.branches': BranchTable;
  'core.financial_years': FinancialYearTable;
  'core.app_settings': AppSettingTable;
  'core.menu_mains': MenuMainTable;
  'core.menu_subs': MenuSubTable;
  'core.menu_forms': MenuFormTable;
  'auth.users': UserTable;
  'auth.user_modules': UserModuleTable;
  'auth.refresh_tokens': RefreshTokenTable;
  'audit.activity_logs': ActivityLogTable;
  'hr.employee_designations': EmployeeDesignationTable;
  'hr.bank_masters': BankMasterTable;
  'hr.employee_leave_types': EmployeeLeaveTypeTable;
  'hr.employees': EmployeeTable;
  'hr.employee_service_histories': EmployeeServiceHistoryTable;
  'hr.employee_retirements': EmployeeRetirementTable;
  'hr.employee_transfers': EmployeeTransferTable;
  'hr.employee_promotions': EmployeePromotionTable;
  'hr.employee_attendances': EmployeeAttendanceTable;
  'payroll.payroll_components': PayrollComponentTable;
  'payroll.payroll_periods': PayrollPeriodTable;
  'payroll.payroll_da_rates': PayrollDaRateTable;
  'payroll.payroll_pf_deduction_rates': PayrollPfDeductionRateTable;
  'payroll.payroll_hra_cca_rates': PayrollHraCcaRateTable;
  'payroll.payrolls': PayrollTable;
}

export type Employee = Selectable<EmployeeTable>;

export type Designation = Selectable<EmployeeDesignationTable>;
export type NewDesignation = Insertable<EmployeeDesignationTable>;
export type DesignationUpdate = Updateable<EmployeeDesignationTable>;
export type User = Selectable<UserTable>;
