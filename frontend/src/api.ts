import type { RoutePlan, ValidationResult } from './types';

const api = async <T>(path: string, options?: RequestInit): Promise<T> => {
  const response = await fetch(path, {
    headers: { 'Content-Type': 'application/json', ...(options?.headers ?? {}) },
    ...options
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({ message: response.statusText }));
    throw new Error(body.message ?? '请求失败');
  }
  return response.status === 204 ? (undefined as T) : response.json();
};

export const planApi = {
  list: () => api<{ plans: RoutePlan[] }>('/api/plans'),
  save: (plan: RoutePlan) => api<{ plan: RoutePlan; validation: ValidationResult }>('/api/plans', {
    method: 'POST',
    body: JSON.stringify(plan)
  }),
  /** 只校验不保存：后端按方案中的起飞时间返回带时效说明的校验结果 */
  validate: (plan: RoutePlan) => api<{ validation: ValidationResult }>('/api/validate', {
    method: 'POST',
    body: JSON.stringify(plan)
  }),
  remove: (id: string) => api<void>(`/api/plans/${id}`, { method: 'DELETE' })
};
