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

function maskedSoftmax(logits: Float32Array, mask: Uint8Array): Float32Array {
  const probs = new Float32Array(logits.length);
  let max = -Infinity;
  for (let i = 0; i < logits.length; i++) {
    if (mask[i] && logits[i] > max) max = logits[i];
  }
  if (!Number.isFinite(max)) return probs;

  let total = 0;
  for (let i = 0; i < logits.length; i++) {
    if (!mask[i]) continue;
    const value = Math.exp(logits[i] - max);
    probs[i] = value;
    total += value;
  }
  if (total <= 0) return probs;
  for (let i = 0; i < probs.length; i++) probs[i] /= total;
  return probs;
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

export function predictPolicy(
  model: ExportedPolicyModel,
  features: Float32Array,
  legalMask: Uint8Array,
): MlPrediction {
  validatePolicyModel(model);
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
  return probabilities.length - 1;
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
  const action = ML_ACTIONS[actionIndex];
  const confidence = prediction.probabilities[actionIndex] ?? 0;

  if (action === 'fold' && legalByType(legal, 'fold')) {
    return { type: 'fold', reason: 'ML policy', confidence };
  }
  if (action === 'check' && legalByType(legal, 'check')) {
    return { type: 'check', reason: 'ML policy', confidence };
  }
  if (action === 'call') {
    const call = legalByType(legal, 'call');
    if (call) return { type: 'call', amount: call.callAmount, reason: 'ML policy', confidence };
  }
  if (action === 'all-in' && legalByType(legal, 'all-in')) {
    return { type: 'all-in', reason: 'ML policy', confidence };
  }
  if (action === 'wager') {
    const wager = legalByType(legal, 'raise') ?? legalByType(legal, 'bet');
    if (wager && (wager.type === 'raise' || wager.type === 'bet')) {
      const min = Math.max(1, Math.floor(wager.min ?? 1));
      const max = Math.max(min, Math.floor(wager.max ?? min));
      const amount = Math.min(max, Math.max(min, Math.round(min + prediction.size * (max - min))));
      return { type: wager.type, amount, reason: 'ML policy', confidence };
    }
  }

  // The mask should make this unreachable, but keep a hard fallback because the
  // engine remains the final authority over every generated decision.
  const check = legalByType(legal, 'check');
  if (check) return { type: 'check', reason: 'ML legal fallback', confidence: 0 };
  const call = legalByType(legal, 'call');
  if (call) return { type: 'call', amount: call.callAmount, reason: 'ML legal fallback', confidence: 0 };
  if (legalByType(legal, 'fold')) return { type: 'fold', reason: 'ML legal fallback', confidence: 0 };
  return { type: legal[0].type, amount: legal[0].min, reason: 'ML legal fallback', confidence: 0 };
}
