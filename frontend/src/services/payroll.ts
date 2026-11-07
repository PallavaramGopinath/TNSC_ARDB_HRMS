import { api } from './api';
import type { EffectiveRate, PayrollComponent, PayrollPeriod } from '@/types/api';

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
