import type { BotDecision, GameState, LegalAction } from '../../types/poker';
import { encodeBotFeatures, legalActionMask, ML_ACTIONS, ML_FEATURE_COUNT } from './features';

export interface DenseLayerWeights {
  input: number;
  output: number;
  weights: number[];
  bias: number[];
  activation?: 'relu' | 'linear';
}

export interface ExportedPolicyModel {
  version: 1;
  featureCount: number;
  actionCount: number;
  trunk: DenseLayerWeights[];
  policy: DenseLayerWeights;
  value: DenseLayerWeights;
  size: DenseLayerWeights;
}

export interface MlPrediction {
  logits: Float32Array;
  probabilities: Float32Array;
  value: number;
  size: number;
}

function sigmoid(x: number): number {
  if (x >= 0) {
    const z = Math.exp(-x);
    return 1 / (1 + z);
  }
  const z = Math.exp(x);
  return z / (1 + z);
}

function dense(input: Float32Array, layer: DenseLayerWeights): Float32Array {
  if (input.length !== layer.input) {
    throw new Error(`ML layer expected ${layer.input} inputs, received ${input.length}`);
  }
  if (layer.weights.length !== layer.input * layer.output || layer.bias.length !== layer.output) {
    throw new Error('Invalid ML layer weight dimensions');
  }

  const out = new Float32Array(layer.output);
  const relu = layer.activation !== 'linear';
  for (let o = 0; o < layer.output; o++) {
    let sum = layer.bias[o] ?? 0;
    const base = o * layer.input;
    for (let i = 0; i < layer.input; i++) sum += input[i] * layer.weights[base + i];
    out[o] = relu ? Math.max(0, sum) : sum;
  }
  return out;
}

export function maskedSoftmax(logits: Float32Array, mask: Uint8Array, temperature = 1): Float32Array {
  const probs = new Float32Array(logits.length);
  const temp = Math.max(0.05, temperature);
  let max = -Infinity;
  for (let i = 0; i < logits.length; i++) {
    if (mask[i] && logits[i] / temp > max) max = logits[i] / temp;
  }
  if (!Number.isFinite(max)) return probs;

  let total = 0;
  for (let i = 0; i < logits.length; i++) {
    if (!mask[i]) continue;
    const value = Math.exp(logits[i] / temp - max);
    probs[i] = value;
    total += value;
  }
  if (total <= 0) return probs;
  for (let i = 0; i < probs.length; i++) probs[i] /= total;
  return probs;
}

export function mixEpsilon(probs: Float32Array, mask: Uint8Array, epsilon: number): Float32Array {
  const out = new Float32Array(probs.length);
  const clipped = Math.min(1, Math.max(0, epsilon));
  let legal = 0;
  for (let i = 0; i < mask.length; i++) if (mask[i]) legal += 1;
  if (legal === 0) return out;
  const uniform = 1 / legal;
  let total = 0;
  for (let i = 0; i < probs.length; i++) {
    if (!mask[i]) continue;
    out[i] = (1 - clipped) * (probs[i] ?? 0) + clipped * uniform;
    total += out[i];
  }
  if (total <= 0) return out;
  for (let i = 0; i < out.length; i++) out[i] /= total;
  return out;
}

export const DEFAULT_SELFPLAY_EXPLORE = {
  temperature: 1.2,
  epsilon: 0.05,
  sizeJitter: 0.08,
} as const;

export type SelfPlayExploreConfig = {
  temperature: number;
  epsilon: number;
  sizeJitter: number;
};

/** Exact self-play sampling distribution. Not greedy softmax. */
export function behaviorProbabilities(
  logits: Float32Array,
  mask: Uint8Array,
  explore: SelfPlayExploreConfig = DEFAULT_SELFPLAY_EXPLORE,
): Float32Array {
  const tempered = maskedSoftmax(logits, mask, explore.temperature);
  return mixEpsilon(tempered, mask, explore.epsilon);
}

export function behaviorLogProb(
  logits: Float32Array,
  mask: Uint8Array,
  action: number,
  explore: SelfPlayExploreConfig = DEFAULT_SELFPLAY_EXPLORE,
): number {
  const probs = behaviorProbabilities(logits, mask, explore);
  return Math.log(Math.max(1e-8, probs[action] ?? 0));
}

const validatedModels = new WeakSet<object>();

export function predictPolicy(
  model: ExportedPolicyModel,
  features: Float32Array,
  legalMask: Uint8Array,
): MlPrediction {
  if (!validatedModels.has(model)) {
    validatePolicyModel(model);
    validatedModels.add(model);
  }
  let hidden = features;
  for (const layer of model.trunk) hidden = dense(hidden, layer);
  const logits = dense(hidden, { ...model.policy, activation: 'linear' });
  const valueRaw = dense(hidden, { ...model.value, activation: 'linear' })[0];
  const sizeRaw = dense(hidden, { ...model.size, activation: 'linear' })[0];
  return {
    logits,
    probabilities: maskedSoftmax(logits, legalMask),
    value: Math.tanh(valueRaw),
    size: sigmoid(sizeRaw),
  };
}

export function validatePolicyModel(model: ExportedPolicyModel): void {
  if (model.version !== 1) throw new Error(`Unsupported ML policy version ${model.version}`);
  if (model.featureCount !== ML_FEATURE_COUNT) {
    throw new Error(`Model feature count ${model.featureCount} != ${ML_FEATURE_COUNT}`);
  }
  if (model.actionCount !== ML_ACTIONS.length) {
    throw new Error(`Model action count ${model.actionCount} != ${ML_ACTIONS.length}`);
  }

  let width = model.featureCount;
  for (const layer of model.trunk) {
    if (layer.input !== width) throw new Error('ML trunk layer dimensions do not connect');
    width = layer.output;
  }
  for (const [name, head, expected] of [
    ['policy', model.policy, model.actionCount],
    ['value', model.value, 1],
    ['size', model.size, 1],
  ] as const) {
    if (head.input !== width || head.output !== expected) {
      throw new Error(`Invalid ${name} head dimensions`);
    }
  }
}

export interface MlExploreSample {
  decision: BotDecision;
  actionIndex: number;
  size: number;
  logProb: number;
  probabilities: Float32Array;
  baseProbabilities: Float32Array;
  value: number;
  features: Float32Array;
  mask: Uint8Array;
  fallback: boolean;
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

function chooseAction(probabilities: Float32Array, rng?: () => number): number {
  if (!rng) {
    let best = 0;
    for (let i = 1; i < probabilities.length; i++) {
      if (probabilities[i] > probabilities[best]) best = i;
    }
    return best;
  }

  let roll = rng();
  for (let i = 0; i < probabilities.length; i++) {
    roll -= probabilities[i];
    if (roll <= 0) return i;
  }
  for (let i = probabilities.length - 1; i >= 0; i--) {
    if ((probabilities[i] ?? 0) > 0) return i;
  }
  return 0;
}

function legalByType(legal: LegalAction[], type: LegalAction['type']): LegalAction | undefined {
  return legal.find((item) => item.type === type);
}

export function decideMlAction(
  model: ExportedPolicyModel,
  state: GameState,
  seatIndex: number,
  legal: LegalAction[],
  rng?: () => number,
): BotDecision {
  if (!legal.length) return { type: 'fold', reason: 'ML: no legal actions', confidence: 1 };
  const mask = legalActionMask(legal);
  const prediction = predictPolicy(model, encodeBotFeatures(state, seatIndex), mask);
  const actionIndex = chooseAction(prediction.probabilities, rng);
  const confidence = prediction.probabilities[actionIndex] ?? 0;
  return decisionFromAction(actionIndex, prediction.size, legal, confidence);
}

function fallbackDecision(legal: LegalAction[]): BotDecision {
  const check = legalByType(legal, 'check');
  if (check) return { type: 'check', reason: 'ML legal fallback', confidence: 0 };
  const call = legalByType(legal, 'call');
  if (call) return { type: 'call', amount: call.callAmount, reason: 'ML legal fallback', confidence: 0 };
  if (legalByType(legal, 'fold')) return { type: 'fold', reason: 'ML legal fallback', confidence: 0 };
  return { type: legal[0].type, amount: legal[0].min, reason: 'ML legal fallback', confidence: 0 };
}

function decisionFromAction(
  actionIndex: number,
  size: number,
  legal: LegalAction[],
  confidence: number,
  reason = 'ML policy',
): BotDecision {
  const action = ML_ACTIONS[actionIndex];
  if (action === 'fold' && legalByType(legal, 'fold')) {
    return { type: 'fold', reason, confidence };
  }
  if (action === 'check' && legalByType(legal, 'check')) {
    return { type: 'check', reason, confidence };
  }
  if (action === 'call') {
    const call = legalByType(legal, 'call');
    if (call) return { type: 'call', amount: call.callAmount, reason, confidence };
  }
  if (action === 'all-in' && legalByType(legal, 'all-in')) {
    return { type: 'all-in', reason, confidence };
  }
  if (action === 'wager') {
    const wager = legalByType(legal, 'raise') ?? legalByType(legal, 'bet');
    if (wager && (wager.type === 'raise' || wager.type === 'bet')) {
      const min = Math.max(1, Math.floor(wager.min ?? 1));
      const max = Math.max(min, Math.floor(wager.max ?? min));
      const amount = Math.min(max, Math.max(min, Math.round(min + clamp01(size) * (max - min))));
      return { type: wager.type, amount, reason, confidence };
    }
  }
  return fallbackDecision(legal);
}

export function sampleMlExplore(
  model: ExportedPolicyModel,
  state: GameState,
  seatIndex: number,
  legal: LegalAction[],
  rng: () => number,
  explore: SelfPlayExploreConfig = DEFAULT_SELFPLAY_EXPLORE,
): MlExploreSample {
  const features = encodeBotFeatures(state, seatIndex);
  const mask = legalActionMask(legal);
  if (!legal.length) {
    return {
      decision: { type: 'fold', reason: 'ML: no legal actions', confidence: 1 },
      actionIndex: 0,
      size: 0,
      logProb: Math.log(1e-8),
      probabilities: new Float32Array(ML_ACTIONS.length),
      baseProbabilities: new Float32Array(ML_ACTIONS.length),
      value: 0,
      features,
      mask,
      fallback: true,
    };
  }

  const prediction = predictPolicy(model, features, mask);
  const probs = behaviorProbabilities(prediction.logits, mask, explore);
  const actionIndex = chooseAction(probs, rng);
  const size = clamp01(prediction.size + (rng() * 2 - 1) * explore.sizeJitter);
  const logProb = Math.log(Math.max(probs[actionIndex] ?? 0, 1e-8));
  const decision = decisionFromAction(actionIndex, size, legal, probs[actionIndex] ?? 0, 'ML explore');
  return {
    decision,
    actionIndex,
    size,
    logProb,
    probabilities: probs,
    baseProbabilities: prediction.probabilities,
    value: prediction.value,
    features,
    mask,
    fallback: /fallback/i.test(decision.reason),
  };
}

export function assignSeatModels(
  seatCount: number,
  primary: ExportedPolicyModel,
  pool: ExportedPolicyModel[],
  rng: () => number,
  primaryShare = 1,
): ExportedPolicyModel[] {
  if (primaryShare >= 1 || pool.length === 0) {
    return Array.from({ length: seatCount }, () => primary);
  }
  const mix = pool;
  const out: ExportedPolicyModel[] = [];
  for (let i = 0; i < seatCount; i++) {
    if (rng() < primaryShare) out.push(primary);
    else out.push(mix[Math.floor(rng() * mix.length)] ?? primary);
  }
  return out;
}
