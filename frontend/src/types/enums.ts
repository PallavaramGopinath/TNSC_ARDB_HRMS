// Mirrors backend/src/models/enums.ts (CHECK constraints in database/schema.sql).
export const Gender = ['M', 'F', 'O'] as const;
export const GenderLabel: Record<string, string> = { M: 'Male', F: 'Female', O: 'Other' };
export const MaritalStatus = ['SINGLE', 'MARRIED', 'DIVORCED', 'WIDOWED', 'SEPARATED'] as const;
export const EmploymentType = ['GOVT_EMPLOYEE', 'PERMANENT', 'CONTRACT', 'DAILY_WAGE'] as const;
export const ModeOfRecruitment = ['DIRECT', 'PROMOTION', 'TRANSFER', 'COMPASSIONATE_GROUND', 'OTHER', 'DEPUTATION'] as const;
export const SponsoredBy = ['TNPSC', 'RECRUITMENT_BOARD', 'EMPLOYMENT_EXCHANGE', 'OTHER'] as const;
export const SpecialCategory = ['COMPASSIONATE_GROUND', 'SPORTS_QUOTA', 'EX_SERVICEMEN', 'DIFFERENTLY_ABLED', 'OTHER'] as const;
export const DeceasedRelationship = ['SPOUSE', 'SON', 'DAUGHTER', 'BROTHER', 'SISTER', 'OTHER'] as const;
export const BloodGroups = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'] as const;
export const PayrollType = ['SALARY', 'DA_ARREARS', 'SLS', 'BONUS', 'EX_GRATIA', 'SALARY_ARREARS', 'GRATUITY', 'LEAVE_ENCASHMENT'] as const;
