import { api } from './api';
import type { LeaveType, BankMaster, BranchMaster, Designation, Employee, EmployeeListItem, Paged, ServiceHistoryRow } from '@/types/api';

export interface DesignationInput {
  designationName: string;
  grade?: string;
  payLevel?: string;
  seniorityOrder?: number | string;
  isActive?: boolean;
}

export interface BranchInput {
  code: string;
  name: string;
  type: 'HO' | 'BRANCH';
  address?: string;
  district?: string;
  pincode?: string;
  phone?: string;
  email?: string;
  placeId?: number | string | null;
  isActive?: boolean;
}

export interface BankInput { bankName: string; ifscForBank: string; isActive?: boolean }

export interface LeaveTypeInput {
  leaveName: string;
  leaveCode: string;
  annualQuota: number | string;
  payCutFactor: number | string;
  carryForward: boolean;
  encashmentAllowed: boolean;
  cutsSpecialPayAndDa: boolean;
  affectsLeaveBalance: boolean;
  isActive?: boolean;
}

export interface EmployeeListParams {
  q?: string;
  branchId?: number;
  designationId?: number;
  status?: 'active' | 'left' | 'all';
  page?: number;
  pageSize?: number;
}

/** Form payload: camelCase keys; blank strings are sent as-is and become null on the server. */
export type EmployeePayload = Record<string, string | number | boolean | null | undefined>;

export const hrApi = {
  designations: {
    list: (params?: { search?: string; includeInactive?: boolean }) =>
      api.get<Designation[]>('/hr/designations', { params }).then((r) => r.data),
    create: (body: DesignationInput) => api.post<Designation>('/hr/designations', body).then((r) => r.data),
    update: (id: number, body: DesignationInput) => api.put<Designation>(`/hr/designations/${id}`, body).then((r) => r.data),
    deactivate: (id: number) => api.delete(`/hr/designations/${id}`),
  },
  employees: {
    list: (params: EmployeeListParams) => api.get<Paged<EmployeeListItem>>('/hr/employees', { params }).then((r) => r.data),
    get: (id: number) => api.get<Employee>(`/hr/employees/${id}`).then((r) => r.data),
    serviceHistory: (id: number) => api.get<ServiceHistoryRow[]>(`/hr/employees/${id}/service-history`).then((r) => r.data),
    create: (body: EmployeePayload) => api.post<Employee>('/hr/employees', body).then((r) => r.data),
    update: (id: number, body: EmployeePayload) => api.put<Employee>(`/hr/employees/${id}`, body).then((r) => r.data),
  },
  leaveTypes: {
    list: (params?: { includeInactive?: boolean }) => api.get<LeaveType[]>('/hr/leave-types', { params }).then((r) => r.data),
    create: (body: LeaveTypeInput) => api.post<LeaveType>('/hr/leave-types', body).then((r) => r.data),
    update: (id: number, body: LeaveTypeInput) => api.put<LeaveType>(`/hr/leave-types/${id}`, body).then((r) => r.data),
    setActive: (id: number, isActive: boolean) => api.delete<LeaveType>(`/hr/leave-types/${id}`, { params: { isActive } }).then((r) => r.data),
    remove: (id: number) => api.delete(`/hr/leave-types/${id}/permanent`),
  },
  branches: {
    list: (params?: { search?: string; includeInactive?: boolean }) => api.get<BranchMaster[]>('/hr/branches', { params }).then((r) => r.data),
    create: (body: BranchInput) => api.post<BranchMaster>('/hr/branches', body).then((r) => r.data),
    update: (id: number, body: BranchInput) => api.put<BranchMaster>(`/hr/branches/${id}`, body).then((r) => r.data),
    setActive: (id: number, isActive: boolean) => api.delete<BranchMaster>(`/hr/branches/${id}`, { params: { isActive } }).then((r) => r.data),
    remove: (id: number) => api.delete(`/hr/branches/${id}/permanent`),
  },
  bankMasters: {
    list: (params?: { search?: string; includeInactive?: boolean }) => api.get<BankMaster[]>('/hr/bank-masters', { params }).then((r) => r.data),
    create: (body: BankInput) => api.post<BankMaster>('/hr/bank-masters', body).then((r) => r.data),
    update: (id: number, body: BankInput) => api.put<BankMaster>(`/hr/bank-masters/${id}`, body).then((r) => r.data),
    setActive: (id: number, isActive: boolean) => api.delete<BankMaster>(`/hr/bank-masters/${id}`, { params: { isActive } }).then((r) => r.data),
    remove: (id: number) => api.delete(`/hr/bank-masters/${id}/permanent`),
  },
};
