/**
 * Enum values — mirror the CHECK constraints in database/schema.sql (TNCU stores enums as strings).
 * Use with zod: z.enum(EmploymentType).
 */
export const BranchType = ['HO', 'BRANCH'] as const;

// ---- HR
export const Gender = ['M', 'F', 'O'] as const;
export const MaritalStatus = ['SINGLE', 'MARRIED', 'DIVORCED', 'WIDOWED', 'SEPARATED'] as const;
export const EmploymentType = ['GOVT_EMPLOYEE', 'PERMANENT', 'CONTRACT', 'DAILY_WAGE'] as const;
export const ModeOfRecruitment = ['DIRECT', 'PROMOTION', 'TRANSFER', 'COMPASSIONATE_GROUND', 'OTHER', 'DEPUTATION'] as const;
export const SponsoredBy = ['TNPSC', 'RECRUITMENT_BOARD', 'EMPLOYMENT_EXCHANGE', 'OTHER'] as const;
export const SpecialCategory = ['COMPASSIONATE_GROUND', 'SPORTS_QUOTA', 'EX_SERVICEMEN', 'DIFFERENTLY_ABLED', 'OTHER'] as const;
export const DeceasedRelationship = ['SPOUSE', 'SON', 'DAUGHTER', 'BROTHER', 'SISTER', 'OTHER'] as const;
export const ServiceEvent = ['APPOINTMENT', 'PROMOTION', 'TRANSFER', 'INCREMENT', 'DEMOTION', 'RETIREMENT', 'LEAVE', 'INCREMENT_WITHHELD'] as const;
export const AttendanceStatus = ['PRESENT', 'ABSENT', 'LEAVE', 'HOLIDAY', 'HALF_DAY'] as const;
export const LeaveApplicationStatus = ['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED'] as const;
export const IncrementKind = ['REGULAR', 'WITHHELD', 'HIGHER_QUALIFICATION', 'STAGNATION', 'ADVANCE', 'SPECIAL'] as const;
export const IncrementStatus = ['PENDING', 'APPROVED', 'REJECTED'] as const;
export const TransferType = ['ADMINISTRATIVE', 'REQUEST', 'PROMOTION', 'DISCIPLINARY'] as const;
export const Session = ['FN', 'AN'] as const;
export const PromotionType = ['REGULAR', 'SELECTION_GRADE', 'SPECIAL', 'REVERSION', 'ADHOC', 'OFFICIATING'] as const;
export const PromotionBasis = ['DPC', 'SENIORITY', 'MERIT', 'COURT_ORDER', 'GOVERNMENT_ORDER', 'ADHOC'] as const;
export const PromotionStatus = ['DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'CANCELLED'] as const;
export const PayFixationOption = ['DATE_OF_PROMOTION', 'NEXT_INCREMENT'] as const;
export const RetirementMode = ['SUPERANNUATION', 'VOLUNTARY_RETIREMENT', 'MEDICAL', 'RESIGNATION', 'DEATH', 'TERMINATION', 'OTHER'] as const;
export const ChargeType = ['MINOR', 'MAJOR'] as const;
export const MinorPenalty = ['CENSURE', 'WITHHOLDING_OF_INCREMENT', 'WITHHOLDING_OF_PROMOTION', 'RECOVERY'] as const;
export const MajorPenalty = ['REDUCTION_TO_LOWER_STAGE', 'REDUCTION_IN_RANK', 'COMPULSORY_RETIREMENT', 'REMOVAL', 'DISMISSAL'] as const;
/** Leave codes the business logic is keyed on (TNCU LeaveCreditRules / LeaveApplicationService). Protected. */
export const SYSTEM_LEAVE_CODES = ['CL', 'EL', 'ML', 'LOP'] as const;
export const SimpleApprovalStatus = ['PENDING', 'APPROVED'] as const;

// ---- Payroll
export const ComponentType = { Earnings: 1, Deductions: 2, LoanDeductions: 3 } as const;
export const AssignedType = ['FIXED', 'PERCENTAGE'] as const;
export const PayrollPeriodStatus = ['OPEN', 'PROCESSED', 'APPROVED', 'LOCKED'] as const;
export const PayrollRecordStatus = ['DRAFT', 'APPROVED', 'PAID'] as const;
export const PayrollType = ['SALARY', 'DA_ARREARS', 'SLS', 'BONUS', 'EX_GRATIA', 'SALARY_ARREARS', 'GRATUITY', 'LEAVE_ENCASHMENT'] as const;

/** Component codes the calculator recognises (TNCU PayrollComponentCodes; matched case-insensitively). */
export const ComponentCode = {
  Basic: 'BASIC',
  PersonalPay: 'PP',
  GradePay: 'GP',
  SpecialPay: 'SP',
  DearnessAllowance: 'DA',
  HouseRentAllowance: 'HRA',
  CityCompensatoryAllowance: 'CCA',
  MedicalAllowance: 'MA',
  ProvidentFund: 'PF',
  EmployerProvidentFund: 'EMPLOYER_PF',
  VoluntaryProvidentFund: 'ADL PF',
  Bonus: 'BONUS',
  ExGratia: 'EX_GRATIA',
  SurrenderLeaveSalary: 'SLS',
  Gratuity: 'GRATUITY',
  IncomeTax: 'IT',
} as const;

/** Allowed period status transitions (TNCU PayrollPeriodService). No reverse from APPROVED/LOCKED. */
export const PeriodTransitions: Record<(typeof PayrollPeriodStatus)[number], readonly (typeof PayrollPeriodStatus)[number][]> = {
  OPEN: ['PROCESSED'],
  PROCESSED: ['APPROVED', 'OPEN'],
  APPROVED: ['LOCKED'],
  LOCKED: [],
};
