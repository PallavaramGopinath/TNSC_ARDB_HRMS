import { api } from './api';
import type {
  EffectiveRate,
  HraCcaBasis,
  HraCcaBasisStatus,
  HraCcaCoverage,
  HraCcaRateDetail,
  HraCcaRateList,
  PayrollComponent,
  PayrollPeriod,
} from '@/types/api';

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
  components: { list: () => api.get<PayrollComponent[]>('/payroll/components').then((r) => r.data) },
  daRates: rateApi('da', 'daPercentage'),
  pfRates: rateApi('pf', 'pfPercentage'),
  hraCcaBasis: {
    status: () => api.get<HraCcaBasisStatus>('/payroll/settings/hra-cca-basis').then((r) => r.data),
    change: (basis: HraCcaBasis) => api.put<HraCcaBasisStatus>('/payroll/settings/hra-cca-basis', { basis }).then((r) => r.data),
    coverage: (basis: HraCcaBasis, asOn?: string) =>
      api.get<HraCcaCoverage>('/payroll/settings/hra-cca-basis/coverage', { params: { basis, asOn } }).then((r) => r.data),
  },
  hraCca: {
    list: (params: HraCcaListParams) => api.get<HraCcaRateList>('/payroll/rates/hra-cca', { params }).then((r) => r.data),
    get: (id: number) => api.get<HraCcaRateDetail>(`/payroll/rates/hra-cca/${id}`).then((r) => r.data),
    create: (body: HraCcaRateInput & { placeId?: number; designationId?: number }) =>
      api.post<HraCcaRateDetail>('/payroll/rates/hra-cca', body).then((r) => r.data),
    update: (id: number, body: HraCcaRateInput) => api.put<HraCcaRateDetail>(`/payroll/rates/hra-cca/${id}`, body).then((r) => r.data),
    revise: (id: number, body: HraCcaRateInput) => api.post<HraCcaRateDetail>(`/payroll/rates/hra-cca/${id}/revise`, body).then((r) => r.data),
    bulkRevise: (body: { effectiveFrom: string; remarks?: string; items: Array<HraCcaRateValues & { keyId: number }> }) =>
      api.post<{ count: number; warnings: string[] }>('/payroll/rates/hra-cca/bulk-revise', body).then((r) => r.data),
    deactivate: (id: number) => api.delete(`/payroll/rates/hra-cca/${id}`),
    missing: (asOn?: string) => api.get<HraCcaCoverage>('/payroll/rates/hra-cca/missing', { params: { asOn } }).then((r) => r.data),
    affected: (params: { placeId?: number; designationId?: number }) =>
      api.get<{ count: number }>('/payroll/rates/hra-cca/affected', { params }).then((r) => r.data),
  },
  periods: {
    list: (params: { status?: string; payrollType?: string; calendarYear?: number }) =>
      api.get<PayrollPeriod[]>('/payroll/periods', { params }).then((r) => r.data),
    create: (body: PeriodInput) => api.post<PayrollPeriod>('/payroll/periods', body).then((r) => r.data),
    update: (id: number, body: PeriodInput) => api.put<PayrollPeriod>(`/payroll/periods/${id}`, body).then((r) => r.data),
    remove: (id: number) => api.delete(`/payroll/periods/${id}`),
    setWorkingDays: (id: number, workingDays: number | null) =>
      api.put<PayrollPeriod>(`/payroll/periods/${id}/working-days`, { workingDays }).then((r) => r.data),
    lockAndRoll: (id: number) =>
      api.post<{ locked: PayrollPeriod; next: PayrollPeriod }>(`/payroll/periods/${id}/lock-and-roll`).then((r) => r.data),
  },
};

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
