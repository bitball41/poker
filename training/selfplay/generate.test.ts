import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createGame, getLegalActions, sitPlayer, startHand } from '../../src/engine/game';
import { createRng } from '../../src/engine/rng';
import {
  DEFAULT_SELFPLAY_EXPLORE,
  behaviorLogProb,
  predictPolicy,
  sampleMlExplore,
  type ExportedPolicyModel,
} from '../../src/bots/ml/model';
import { legalizeBotDecision } from '../../src/bots/legalize';
import { decisionToTrainingTarget } from '../../src/bots/ml/features';
import { featuresIgnoreHiddenCards } from '../../eval/harness';
import {
  advantage,
  approxKl,
  clippedPolicyLoss,
  clippedSurrogate,
  legalEntropy,
  normalizeAdvantages,
  normalizeChipDelta,
  normalizedLegalEntropy,
  ppoRatio,
  ppoShouldStop,
} from './targets';
import {
  generateSelfPlayDataset,
  playSelfPlayHand,
  readSelfPlayShard,
  RECORD_BYTES,
  SELFPLAY_DATASET_VERSION,
  tableSizeForHand,
} from './generate';

function tinyModel(): ExportedPolicyModel {
  const zeros = (n: number) => Array(n).fill(0);
  const layer = (input: number, output: number, activation: 'relu' | 'linear' = 'linear') => ({
    input,
    output,
    weights: zeros(input * output),
    bias: zeros(output),
    activation,
  });
  return {
    version: 1,
    featureCount: 160,
    actionCount: 5,
    trunk: [layer(160, 8, 'relu'), layer(8, 8, 'relu'), layer(8, 4, 'relu')],
    policy: layer(4, 5),
    value: layer(4, 1),
    size: layer(4, 1),
  };
}

function biasedTinyModel(): ExportedPolicyModel {
  const model = tinyModel();
  model.policy.bias = [6, 0, 0, 0, 0];
  return model;
}

function tmpBin(name: string): string {
  return path.join(os.tmpdir(), `liminal-selfplay-${name}-${process.pid}.bin`);
}

function hashFile(filePath: string): string {
  return createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

describe('self-play targets', () => {
  it('normalizes chip delta into a bounded tanh-friendly target', () => {
    expect(normalizeChipDelta(0, 400)).toBe(0);
    expect(normalizeChipDelta(400, 400)).toBe(1);
    expect(normalizeChipDelta(-400, 400)).toBe(-1);
    expect(normalizeChipDelta(800, 400)).toBe(1);
    expect(normalizeChipDelta(-12, 400)).toBeCloseTo(-12 / 400);
    expect(normalizeChipDelta(Number.NaN, 400)).toBe(0);
    expect(normalizeChipDelta(10, 0)).toBe(1);
  });

  it('computes advantage as return minus old behavior value', () => {
    expect(advantage(0.2, 0.1)).toBeCloseTo(0.1);
    expect(advantage(-0.4, 0.1)).toBeCloseTo(-0.5);
    expect(advantage(Number.NaN, 0.1)).toBe(0);
    expect(Number.isFinite(advantage(1, -1))).toBe(true);
  });

  it('computes PPO ratio, clipped surrogate, and advantage normalization', () => {
    expect(ppoRatio(Math.log(0.4), Math.log(0.2))).toBeCloseTo(2);
    expect(clippedSurrogate(2, 1, 0.15)).toBeCloseTo(1.15);
    expect(clippedSurrogate(2, -1, 0.15)).toBeCloseTo(-2);
    expect(clippedSurrogate(0.5, 1, 0.15)).toBeCloseTo(0.5);
    expect(clippedPolicyLoss([2], [1], 0.15)).toBeCloseTo(-1.15);
    const normalized = normalizeAdvantages([1, 3, 5]);
    const mean = normalized.reduce((sum, value) => sum + value, 0) / normalized.length;
    expect(mean).toBeCloseTo(0);
    expect(normalized[0]).toBeLessThan(0);
    expect(normalized[2]).toBeGreaterThan(0);
  });

  it('computes entropy only over legal actions and ignores 1-action states', () => {
    const uniform = [0.5, 0.5, 0, 0, 0];
    const mask = [1, 1, 0, 0, 0];
    expect(legalEntropy(uniform, mask)).toBeCloseTo(Math.log(2));
    expect(normalizedLegalEntropy(uniform, mask)).toBeCloseTo(1);
    expect(normalizedLegalEntropy([1, 0, 0, 0, 0], [1, 0, 0, 0, 0])).toBeNull();
    expect(legalEntropy([0.5, 0.5, 0.9, 0, 0], mask)).toBeCloseTo(Math.log(2));
  });

  it('computes sampled KL and early-stop conditions', () => {
    expect(approxKl(Math.log(0.4), Math.log(0.2))).toBeCloseTo(Math.log(2));
    expect(ppoShouldStop(
      { kl: 0.01, normalizedEntropy: 0.7, logitAbsMax: 4, valueMae: 0.2, finite: true },
      { normalizedEntropy: 0.75, valueMae: 0.2 },
    )).toBeNull();
    expect(ppoShouldStop(
      { kl: 0.04, normalizedEntropy: 0.7, logitAbsMax: 4, valueMae: 0.2, finite: true },
      { normalizedEntropy: 0.75, valueMae: 0.2 },
    )).toBe('kl');
    expect(ppoShouldStop(
      { kl: 0.01, normalizedEntropy: 0.05, logitAbsMax: 4, valueMae: 0.2, finite: true },
      { normalizedEntropy: 0.8, valueMae: 0.2 },
    )).toBe('entropy-collapse');
    expect(ppoShouldStop(
      { kl: 0.01, normalizedEntropy: 0.7, logitAbsMax: 40, valueMae: 0.2, finite: true },
      { normalizedEntropy: 0.75, valueMae: 0.2 },
    )).toBe('logit-explode');
    expect(ppoShouldStop(
      { kl: 0.01, normalizedEntropy: 0.7, logitAbsMax: 4, valueMae: 0.9, finite: true },
      { normalizedEntropy: 0.75, valueMae: 0.2 },
    )).toBe('value-mae');
    expect(ppoShouldStop(
      { kl: 0, normalizedEntropy: 0, logitAbsMax: 0, valueMae: 0, finite: false },
      { normalizedEntropy: 0.75, valueMae: 0.2 },
    )).toBe('non-finite');
  });
});

describe('self-play generator', () => {
  it('mixes HU / 3-max / 6-max instead of collapsing to heads-up', () => {
    expect([tableSizeForHand(0), tableSizeForHand(1), tableSizeForHand(2)]).toEqual([2, 3, 6]);
  });

  it('is deterministic for a fixed exploration RNG seed', () => {
    const model = tinyModel();
    const play = (label: string) => generateSelfPlayDataset({
      hands: 6,
      worker: 0,
      seed: 4242,
      outPath: tmpBin(label),
      primaryModel: model,
      pool: [model],
      primaryShare: 1,
      explore: DEFAULT_SELFPLAY_EXPLORE,
      startStack: 400,
      smallBlind: 2,
      bigBlind: 4,
    });
    const a = play('det-a');
    const b = play('det-b');
    expect(a.decisions).toBe(b.decisions);
    expect(a.actionCounts).toEqual(b.actionCounts);
    expect(fs.readFileSync(tmpBin('det-a'))).toEqual(fs.readFileSync(tmpBin('det-b')));
  });

  it('never records an illegal action under the mask', () => {
    const model = tinyModel();
    const rng = createRng(99);
    for (let i = 0; i < 40; i++) {
      const played = playSelfPlayHand({
        seats: tableSizeForHand(i),
        seed: 1000 + i,
        rng,
        primary: model,
        pool: [model],
        primaryShare: 1,
        explore: DEFAULT_SELFPLAY_EXPLORE,
      });
      for (const record of played.records) {
        expect(record.mask[record.action]).toBe(1);
        expect(record.action).toBeGreaterThanOrEqual(0);
        expect(record.action).toBeLessThan(5);
        expect(Number.isFinite(record.oldLogProb)).toBe(true);
        expect(record.oldLogProb).toBeLessThanOrEqual(0);
        expect(Number.isFinite(record.oldValue)).toBe(true);
        expect(record.oldValue).toBeGreaterThanOrEqual(-1);
        expect(record.oldValue).toBeLessThanOrEqual(1);
      }
    }
  });

  it('does not leak hidden cards into the feature vector', () => {
    let game = createGame({ smallBlind: 2, bigBlind: 4, maxSeats: 3, seed: 9 });
    game = sitPlayer(game, 0, { playerId: 'a', name: 'A', stack: 400 });
    game = sitPlayer(game, 1, { playerId: 'b', name: 'B', stack: 400 });
    game = sitPlayer(game, 2, { playerId: 'c', name: 'C', stack: 400 });
    game = startHand(game, 13);
    expect(featuresIgnoreHiddenCards(game, game.currentSeat!)).toBe(true);

    const model = tinyModel();
    const played = playSelfPlayHand({
      seats: 3,
      seed: 13,
      rng: createRng(13),
      primary: model,
      pool: [model],
      primaryShare: 1,
      explore: DEFAULT_SELFPLAY_EXPLORE,
    });
    for (const record of played.records) {
      const holeOnes = Array.from(record.features.slice(0, 52)).reduce((sum, value) => sum + value, 0);
      const boardOnes = Array.from(record.features.slice(52, 104)).reduce((sum, value) => sum + value, 0);
      expect(holeOnes).toBeLessThanOrEqual(2);
      expect(boardOnes).toBeLessThanOrEqual(5);
    }
  });

  it('stores chip-delta targets and the matching normalized value', () => {
    const model = tinyModel();
    const played = playSelfPlayHand({
      seats: 2,
      seed: 777,
      rng: createRng(777),
      primary: model,
      pool: [model],
      primaryShare: 1,
      explore: DEFAULT_SELFPLAY_EXPLORE,
      startStack: 400,
    });
    expect(played.records.length).toBeGreaterThan(0);
    for (const record of played.records) {
      const end = played.state.seats[record.seat]?.stack ?? 0;
      expect(record.chipDelta).toBe(end - 400);
      expect(record.reward).toBeCloseTo(normalizeChipDelta(record.chipDelta, 400));
      expect(record.reward).toBeGreaterThanOrEqual(-1);
      expect(record.reward).toBeLessThanOrEqual(1);
      expect(record.tableSize).toBe(2);
      expect(record.oldValue).toBeCloseTo(0);
      const legal = Array.from(record.mask).reduce((sum, bit) => sum + bit, 0);
      expect(record.oldLogProb).toBeCloseTo(Math.log(1 / Math.max(1, legal)), 5);
    }
  });

  it('writes version-3 shards with behavior log-prob and value', () => {
    const model = tinyModel();
    const outPath = tmpBin('layout');
    generateSelfPlayDataset({
      hands: 3,
      worker: 0,
      seed: 12,
      outPath,
      primaryModel: model,
      pool: [model],
      primaryShare: 1,
      explore: DEFAULT_SELFPLAY_EXPLORE,
      startStack: 400,
      smallBlind: 2,
      bigBlind: 4,
    });
    const buf = fs.readFileSync(outPath);
    expect(buf.subarray(0, 4).toString('ascii')).toBe('LPTR');
    expect(buf.readUInt32LE(4)).toBe(SELFPLAY_DATASET_VERSION);
    expect((buf.length - 16) % RECORD_BYTES).toBe(0);
    expect(RECORD_BYTES).toBe(672);
    const records = readSelfPlayShard(outPath);
    expect(records.length).toBeGreaterThan(0);
    expect(records.some((row) => row.tableSize === 2)).toBe(true);
    expect(records.every((row) => Number.isFinite(row.oldLogProb) && Number.isFinite(row.oldValue))).toBe(true);
    expect(new Set(records.map((row) => row.handId)).size).toBeGreaterThan(1);
  });

  it('samples legal actions instead of uniform noise', () => {
    let game = createGame({ smallBlind: 2, bigBlind: 4, maxSeats: 2, seed: 5 });
    game = sitPlayer(game, 0, { playerId: 'a', name: 'A', stack: 400 });
    game = sitPlayer(game, 1, { playerId: 'b', name: 'B', stack: 400 });
    game = startHand(game, 17);
    const legal = getLegalActions(game);
    const sample = sampleMlExplore(tinyModel(), game, game.currentSeat!, legal, createRng(3));
    expect(sample.mask[sample.actionIndex]).toBe(1);
    const legalMass = Array.from(sample.probabilities).reduce((sum, p, i) => sum + (sample.mask[i] ? p : 0), 0);
    expect(legalMass).toBeCloseTo(1, 5);
    const illegalMass = Array.from(sample.probabilities).reduce((sum, p, i) => sum + (sample.mask[i] ? 0 : p), 0);
    expect(illegalMass).toBe(0);
  });

  it('stores explore-mix log-prob, not T=1 softmax, for PPO', () => {
    const model = biasedTinyModel();
    let game = createGame({ smallBlind: 2, bigBlind: 4, maxSeats: 2, seed: 5 });
    game = sitPlayer(game, 0, { playerId: 'a', name: 'A', stack: 400 });
    game = sitPlayer(game, 1, { playerId: 'b', name: 'B', stack: 400 });
    game = startHand(game, 17);
    const legal = getLegalActions(game);
    const sample = sampleMlExplore(model, game, game.currentSeat!, legal, createRng(3));
    const legalized = legalizeBotDecision(sample.decision, legal, game.seats[game.currentSeat!]!.stack);
    const target = decisionToTrainingTarget(legalized, legal);
    const stored = Math.log(Math.max(1e-8, sample.probabilities[target.action] ?? 0));
    const predicted = predictPolicy(model, sample.features, sample.mask);
    expect(stored).toBeCloseTo(behaviorLogProb(predicted.logits, sample.mask, target.action), 5);
    const base = Math.log(Math.max(1e-8, sample.baseProbabilities[target.action] ?? 0));
    expect(Math.abs(stored - base)).toBeGreaterThan(1e-4);

    const played = playSelfPlayHand({
      seats: 2,
      seed: 42,
      rng: createRng(42),
      primary: model,
      pool: [model],
      primaryShare: 1,
      explore: DEFAULT_SELFPLAY_EXPLORE,
    });
    expect(played.records.length).toBeGreaterThan(0);
    let diverged = 0;
    for (const record of played.records) {
      const pred = predictPolicy(model, record.features, record.mask);
      expect(record.oldLogProb).toBeCloseTo(behaviorLogProb(pred.logits, record.mask, record.action), 4);
      const t1 = Math.log(Math.max(1e-8, pred.probabilities[record.action] ?? 0));
      if (Math.abs(record.oldLogProb - t1) > 1e-4) diverged += 1;
    }
    expect(diverged).toBeGreaterThan(0);
  });

  it('does not touch frozen policy-v1 weights', () => {
    const v1 = path.join('training', 'out', 'policy-v1.json');
    const pt = path.join('training', 'out', 'policy-v1.pt');
    if (!fs.existsSync(v1)) return;
    const beforeJson = hashFile(v1);
    const beforePt = fs.existsSync(pt) ? hashFile(pt) : '';
    const primary = JSON.parse(fs.readFileSync(v1, 'utf8')) as ExportedPolicyModel;
    generateSelfPlayDataset({
      hands: 2,
      worker: 0,
      seed: 1,
      outPath: tmpBin('v1-guard'),
      primaryModel: primary,
      pool: [primary],
      primaryShare: 1,
      explore: DEFAULT_SELFPLAY_EXPLORE,
      startStack: 400,
      smallBlind: 2,
      bigBlind: 4,
    });
    expect(hashFile(v1)).toBe(beforeJson);
    if (beforePt) expect(hashFile(pt)).toBe(beforePt);
  });
});
