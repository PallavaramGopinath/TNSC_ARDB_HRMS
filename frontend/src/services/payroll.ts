import { api } from './api';
import type {
  AllowancePreview,
  AssignedType,
  AttendanceSheetImport,
  ComponentAssignmentDetail,
  ComponentAssignmentList,
  DeductionSheetImport,
  EffectiveRate,
  HraAmount,
  HraAmountDetail,
  HraCcaBasis,
  HraCcaBasisStatus,
  HraCcaCoverage,
  HraCcaRateDetail,
  HraCcaRateList,
  HraMethod,
  ManualDeductions,
  RateCoverage,
  PayBillDetail,
  PayBillReport,
  PayrollComponent,
  PayrollPeriod,
  PayrollReadiness,
  PayrollRunGrid,
  PeriodAttendance,
  PeriodDeductions,
  PrepareResult,
} from '@/types/api';

export interface PayrollComponentInput {
  componentName: string;
  componentCode: string;
  componentType: 1 | 2 | 3;
  isDaApplicable: boolean;
  isSurrenderLeaveApplicable: boolean;
  isIncomeTaxApplicable: boolean;
  displayOrder: number | string | null;
  calculationMethod: string | null;
  calculationBasis: string | null;
  minimumAmount: number | string;
  maximumAmount: number | string;
  isActive?: boolean;
}

/** DA and PF share one API shape; the POST body names the percentage field per rate. */
export interface RateApi {
  list: () => Promise<EffectiveRate[]>;
  create: (effectiveFrom: string, percentage: string) => Promise<EffectiveRate>;
}

const rateApi = (path: 'da' | 'pf', field: 'daPercentage' | 'pfPercentage'): RateApi => ({
  list: () => api.get<EffectiveRate[]>(`/payroll/rates/${path}`).then((r) => r.data),
  create: (effectiveFrom, percentage) => api.post<EffectiveRate>(`/payroll/rates/${path}`, { effectiveFrom, [field]: percentage }).then((r) => r.data),
});

export const payrollApi = {
  components: {
    list: (params?: { includeInactive?: boolean }) => api.get<PayrollComponent[]>('/payroll/components', { params }).then((r) => r.data),
    create: (body: PayrollComponentInput) => api.post<PayrollComponent>('/payroll/components', body).then((r) => r.data),
    update: (id: number, body: PayrollComponentInput) => api.put<PayrollComponent>(`/payroll/components/${id}`, body).then((r) => r.data),
    setActive: (id: number, isActive: boolean) =>
      api.delete<PayrollComponent>(`/payroll/components/${id}`, { params: { isActive } }).then((r) => r.data),
    remove: (id: number) => api.delete(`/payroll/components/${id}/permanent`),
  },
  assignments: {
    list: (params: AssignmentListParams) => api.get<ComponentAssignmentList>('/payroll/component-assignments', { params }).then((r) => r.data),
    get: (id: number) => api.get<ComponentAssignmentDetail>(`/payroll/component-assignments/${id}`).then((r) => r.data),
    create: (body: AssignmentInput & { employeeId: number; componentId: number | string }) =>
      api.post<ComponentAssignmentDetail>('/payroll/component-assignments', body).then((r) => r.data),
    update: (id: number, body: AssignmentInput) => api.put<ComponentAssignmentDetail>(`/payroll/component-assignments/${id}`, body).then((r) => r.data),
    revise: (id: number, body: AssignmentInput) => api.post<ComponentAssignmentDetail>(`/payroll/component-assignments/${id}/revise`, body).then((r) => r.data),
    deactivate: (id: number) => api.delete(`/payroll/component-assignments/${id}`),
  },
  daRates: rateApi('da', 'daPercentage'),
  pfRates: rateApi('pf', 'pfPercentage'),
  hraCcaBasis: {
    status: () => api.get<HraCcaBasisStatus>('/payroll/settings/hra-cca-basis').then((r) => r.data),
    change: (method: HraMethod) => api.put<HraCcaBasisStatus>('/payroll/settings/hra-cca-basis', { method }).then((r) => r.data),
    coverage: (method: HraMethod, asOn?: string) =>
      api.get<HraCcaCoverage>('/payroll/settings/hra-cca-basis/coverage', { params: { method, asOn } }).then((r) => r.data),
  },
  hraCca: {
    list: (params: HraCcaListParams) => api.get<HraCcaRateList>('/payroll/rates/hra-cca', { params }).then((r) => r.data),
    get: (id: number) => api.get<HraCcaRateDetail>(`/payroll/rates/hra-cca/${id}`).then((r) => r.data),
    create: (body: HraCcaRateInput & { placeId?: number; designationId?: number }) =>
      api.post<HraCcaRateDetail>('/payroll/rates/hra-cca', body).then((r) => r.data),
    update: (id: number, body: HraCcaRateInput) => api.put<HraCcaRateDetail>(`/payroll/rates/hra-cca/${id}`, body).then((r) => r.data),
    revise: (id: number, body: HraCcaRateInput) => api.post<HraCcaRateDetail>(`/payroll/rates/hra-cca/${id}/revise`, body).then((r) => r.data),
    bulkRevise: (body: { basis: HraCcaBasis; effectiveFrom: string; remarks?: string; items: Array<HraCcaRateValues & { keyId: number }> }) =>
      api.post<{ count: number; warnings: string[] }>('/payroll/rates/hra-cca/bulk-revise', body).then((r) => r.data),
    deactivate: (id: number) => api.delete(`/payroll/rates/hra-cca/${id}`),
    missing: (asOn?: string) => api.get<HraCcaCoverage>('/payroll/rates/hra-cca/missing', { params: { asOn } }).then((r) => r.data),
    affected: (params: { placeId?: number; designationId?: number }) =>
      api.get<{ count: number }>('/payroll/rates/hra-cca/affected', { params }).then((r) => r.data),
  },
  hraAmounts: {
    list: (params: { designationId?: number; status?: string; asOn?: string; search?: string }) =>
      api.get<{ asOn: string; items: HraAmount[] }>('/payroll/rates/hra-amounts', { params }).then((r) => r.data),
    get: (id: number) => api.get<HraAmountDetail>(`/payroll/rates/hra-amounts/${id}`).then((r) => r.data),
    create: (body: HraAmountInput & { designationId: number | string }) => api.post<HraAmountDetail>('/payroll/rates/hra-amounts', body).then((r) => r.data),
    update: (id: number, body: HraAmountInput) => api.put<HraAmountDetail>(`/payroll/rates/hra-amounts/${id}`, body).then((r) => r.data),
    revise: (id: number, body: HraAmountInput) => api.post<HraAmountDetail>(`/payroll/rates/hra-amounts/${id}/revise`, body).then((r) => r.data),
    deactivate: (id: number) => api.delete(`/payroll/rates/hra-amounts/${id}`),
    missing: (asOn?: string) => api.get<RateCoverage & { asOn: string }>('/payroll/rates/hra-amounts/missing', { params: { asOn } }).then((r) => r.data),
  },
  periods: {
    allowances: (id: number) => api.get<AllowancePreview>(`/payroll/periods/${id}/allowances`).then((r) => r.data),
    list: (params: { status?: string; payrollType?: string; calendarYear?: number }) =>
      api.get<PayrollPeriod[]>('/payroll/periods', { params }).then((r) => r.data),
    create: (body: PeriodInput) => api.post<PayrollPeriod>('/payroll/periods', body).then((r) => r.data),
    update: (id: number, body: PeriodInput) => api.put<PayrollPeriod>(`/payroll/periods/${id}`, body).then((r) => r.data),
    remove: (id: number) => api.delete(`/payroll/periods/${id}`),
    setWorkingDays: (id: number, workingDays: number | null) =>
      api.put<PayrollPeriod>(`/payroll/periods/${id}/working-days`, { workingDays }).then((r) => r.data),
    lockAndRoll: (id: number) =>
      api.post<{ locked: PayrollPeriod; next: PayrollPeriod }>(`/payroll/periods/${id}/lock-and-roll`).then((r) => r.data),
    resolveActive: () => api.post<PayrollPeriod>('/payroll/periods/resolve-active').then((r) => r.data),
    reject: (id: number, reason: string) => api.post<PayrollPeriod>(`/payroll/periods/${id}/reject`, { reason }).then((r) => r.data),
    reverseApproval: (id: number, reason: string) => api.post<PayrollPeriod>(`/payroll/periods/${id}/reverse-approval`, { reason }).then((r) => r.data),
  },
  /** Payroll Preparation (specs/08). `confirm…` answers a 409 that asked the user first. */
  preparation: {
    grid: (periodId: number) => api.get<PayrollRunGrid>(`/payroll/payrolls/preparation/${periodId}`).then((r) => r.data),
    bill: (id: number) => api.get<PayBillDetail>(`/payroll/payrolls/${id}`).then((r) => r.data),
    payBill: (periodId: number, branchId?: number) =>
      api.get<PayBillReport>(`/payroll/payrolls/preparation/${periodId}/pay-bill`, { params: branchId ? { branchId } : {} }).then((r) => r.data),
    readiness: (periodId: number) => api.get<PayrollReadiness>(`/payroll/readiness/${periodId}`).then((r) => r.data),
    prepare: (periodId: number, confirmAttendance: boolean) =>
      api.post<PrepareResult>('/payroll/payrolls/compute', { periodId, confirmAttendance }).then((r) => r.data),
    approve: (periodId: number) => api.post<PayrollPeriod>('/payroll/payrolls/approve-run', { periodId }).then((r) => r.data),
    withhold: (id: number, withheld: boolean, reason?: string) =>
      api.put<PayBillDetail>(`/payroll/payrolls/${id}/withhold`, { withheld, reason }).then((r) => r.data),
  },
  periodAttendance: {
    get: (periodId: number) => api.get<PeriodAttendance>(`/payroll/period-attendance/${periodId}`).then((r) => r.data),
    save: (periodId: number, body: { entries: AttendanceEntry[]; confirm: boolean }) =>
      api.put<{ saved: number; removed: number }>(`/payroll/period-attendance/${periodId}`, body).then((r) => r.data),
    import: (periodId: number, body: { headers: string[]; rows: Array<{ line: number; code: string; values: string[] }>; dryRun: boolean; confirm: boolean }) =>
      api.post<AttendanceSheetImport>(`/payroll/period-attendance/${periodId}/import`, body).then((r) => r.data),
  },
  periodDeductions: {
    get: (periodId: number) => api.get<PeriodDeductions>(`/payroll/period-deductions/${periodId}`).then((r) => r.data),
    save: (periodId: number, body: { entries: DeductionEntry[]; confirm: boolean }) =>
      api.put<{ saved: number; removed: number }>(`/payroll/period-deductions/${periodId}`, body).then((r) => r.data),
    import: (periodId: number, body: { componentId: number; sheetCode: string | null; rows: Array<{ line: number; code: string; amount: string }>; dryRun: boolean; confirm: boolean }) =>
      api.post<DeductionSheetImport>(`/payroll/period-deductions/${periodId}/import`, body).then((r) => r.data),
  },
  manualDeductions: {
    get: (periodId: number, employeeId: number) => api.get<ManualDeductions>(`/payroll/manual-deductions/${periodId}/${employeeId}`).then((r) => r.data),
    save: (periodId: number, employeeId: number, entries: Array<{ componentId: number; amount: number | null; remarks: string }>) =>
      api.put<PrepareResult>(`/payroll/manual-deductions/${periodId}/${employeeId}`, { entries }).then((r) => r.data),
  },
};

export interface AttendanceEntry {
  employeeId: number;
  headQuarters: number;
  camp: number;
  remarks: string;
  leaves: Array<{ leaveTypeId: number; days: number }>;
}

export interface DeductionEntry {
  employeeId: number;
  componentId: number;
  amount: number | null;
  remarks: string;
}

export interface PeriodInput {
  payrollType: string;
  month: number | string;
  calendarYear: number | string;
  fromDate: string;
  toDate: string;
  branchId: number | string;
  daRate: number | string;
  arrearFromDate?: string;
  arrearToDate?: string;
}

export interface HraCcaListParams {
  basis?: HraCcaBasis;
  placeId?: number;
  designationId?: number;
  status?: string;
  asOn?: string;
  search?: string;
  page?: number;
  size?: number;
}

export interface HraCcaRateValues {
  hraPercent: string | number;
  hraMinAmount: string | number;
  hraMaxAmount: string | number;
  ccaPercent: string | number;
  ccaMinAmount: string | number;
  ccaMaxAmount: string | number;
  remarks?: string;
}

export interface HraCcaRateInput extends HraCcaRateValues {
  effectiveFrom: string;
  effectiveTo?: string;
}

export interface HraAmountInput {
  gccAmount: string | number;
  otherAmount: string | number;
  effectiveFrom: string;
  effectiveTo?: string;
  remarks?: string;
}

export interface AssignmentListParams {
  employeeId?: number;
  componentId?: number | string;
  status?: string;
  asOn?: string;
  search?: string;
  page?: number;
  size?: number;
}

/** Only the figures of the chosen type are kept; the server stores the others as 0. */
export interface AssignmentInput {
  assignedType: AssignedType;
  assignedAmount: string;
  percentage: string;
  minimumAmount: string;
  maximumAmount: string;
  effectiveFrom: string;
  effectiveTo?: string;
}
