import { randomUUID } from 'node:crypto';
import type { RoutePlan } from './types.js';

const plans = new Map<string, RoutePlan>();

export function listPlans(): RoutePlan[] {
  return [...plans.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export function getPlan(id: string): RoutePlan | undefined {
  return plans.get(id);
}

export function savePlan(input: Omit<RoutePlan, 'id' | 'createdAt' | 'updatedAt'> & Partial<Pick<RoutePlan, 'id' | 'createdAt'>>): RoutePlan {
  const now = new Date().toISOString();
  const id = input.id ?? randomUUID();
  const existing = plans.get(id);
  const plan: RoutePlan = {
    ...input,
    id,
    createdAt: input.createdAt ?? existing?.createdAt ?? now,
    updatedAt: now
  };
  plans.set(id, plan);
  return plan;
}

export function deletePlan(id: string): boolean {
  return plans.delete(id);
}
