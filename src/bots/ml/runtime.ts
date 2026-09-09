import type { ExportedPolicyModel } from './model';
import { validatePolicyModel } from './model';
import shippedPolicy from './policy-v1.json' with { type: 'json' };

let cached: ExportedPolicyModel | null | undefined;

/** Cached greedy policy-v1. Returns null if the shipped weights fail validation. */
export function getShippedPolicy(): ExportedPolicyModel | null {
  if (cached !== undefined) return cached;
  try {
    const model = shippedPolicy as ExportedPolicyModel;
    validatePolicyModel(model);
    cached = model;
  } catch {
    cached = null;
  }
  return cached;
}

export function resetShippedPolicyCacheForTests(): void {
  cached = undefined;
}
