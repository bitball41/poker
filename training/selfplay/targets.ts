/** Chip-EV value target for the tanh value head. Not a win/loss bit. */
export function normalizeChipDelta(delta: number, startStack: number): number {
  const scale = Math.max(1, startStack);
  const value = delta / scale;
  if (!Number.isFinite(value)) return 0;
  return Math.max(-1, Math.min(1, value));
}

/** Advantage against the frozen behavior-policy value, not the live head. */
export function advantage(normalizedReturn: number, oldValue: number): number {
  if (!Number.isFinite(normalizedReturn) || !Number.isFinite(oldValue)) return 0;
  return normalizedReturn - oldValue;
}

export function ppoRatio(newLogProb: number, oldLogProb: number): number {
  const value = Math.exp(newLogProb - oldLogProb);
  if (!Number.isFinite(value)) return 0;
  return value;
}

export function normalizeAdvantages(values: number[]): number[] {
  if (!values.length) return [];
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  let varSum = 0;
  for (const value of values) varSum += (value - mean) ** 2;
  const std = Math.sqrt(varSum / values.length) + 1e-8;
  return values.map((value) => (value - mean) / std);
}

export function clippedSurrogate(ratio: number, adv: number, clip = 0.15): number {
  const unclipped = ratio * adv;
  const clippedRatio = Math.min(1 + clip, Math.max(1 - clip, ratio));
  return Math.min(unclipped, clippedRatio * adv);
}

export function clippedPolicyLoss(ratios: number[], advantages: number[], clip = 0.15): number {
  if (!ratios.length) return 0;
  let total = 0;
  for (let i = 0; i < ratios.length; i++) total += clippedSurrogate(ratios[i]!, advantages[i]!, clip);
  return -total / ratios.length;
}

export function legalEntropy(probs: number[], mask: ArrayLike<number>): number {
  let entropy = 0;
  for (let i = 0; i < probs.length; i++) {
    if (!mask[i]) continue;
    const p = probs[i] ?? 0;
    if (p <= 0) continue;
    entropy -= p * Math.log(p);
  }
  return entropy;
}

export function legalActionCount(mask: ArrayLike<number>): number {
  let count = 0;
  for (let i = 0; i < mask.length; i++) if (mask[i]) count += 1;
  return count;
}

export function normalizedLegalEntropy(probs: number[], mask: ArrayLike<number>): number | null {
  const legal = legalActionCount(mask);
  if (legal <= 1) return null;
  return legalEntropy(probs, mask) / Math.log(legal);
}

/** Sampled-action KL(pi_old || pi_new) ≈ E[oldLogProb - newLogProb]. */
export function approxKl(oldLogProb: number, newLogProb: number): number {
  const value = oldLogProb - newLogProb;
  return Number.isFinite(value) ? value : 0;
}

export type PpoStopStats = {
  kl: number;
  normalizedEntropy: number;
  logitAbsMax: number;
  valueMae: number;
  finite: boolean;
};

export type PpoStopBaseline = {
  normalizedEntropy: number;
  valueMae: number;
  klLimit?: number;
  entropyFloor?: number;
  logitLimit?: number;
  valueMaeMult?: number;
};

export function ppoShouldStop(stats: PpoStopStats, baseline: PpoStopBaseline): string | null {
  if (!stats.finite) return 'non-finite';
  const klLimit = baseline.klLimit ?? 0.03;
  if (stats.kl > klLimit) return 'kl';
  const entropyFloor = baseline.entropyFloor ?? 0.15;
  if (baseline.normalizedEntropy > 0.4 && stats.normalizedEntropy < entropyFloor) return 'entropy-collapse';
  const logitLimit = baseline.logitLimit ?? 30;
  if (stats.logitAbsMax > logitLimit) return 'logit-explode';
  const mult = baseline.valueMaeMult ?? 2;
  if (baseline.valueMae > 0.05 && stats.valueMae > Math.max(0.45, mult * baseline.valueMae)) return 'value-mae';
  return null;
}
