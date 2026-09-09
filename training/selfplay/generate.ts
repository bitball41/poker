import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { applyAction, createGame, getLegalActions, sitPlayer, startHand } from '../../src/engine/game';
import { createRng } from '../../src/engine/rng';
import { legalizeBotDecision } from '../../src/bots/legalize';
import {
  decisionToTrainingTarget,
  ML_ACTIONS,
  ML_FEATURE_COUNT,
} from '../../src/bots/ml/features';
import {
  assignSeatModels,
  DEFAULT_SELFPLAY_EXPLORE,
  sampleMlExplore,
  type ExportedPolicyModel,
  type SelfPlayExploreConfig,
} from '../../src/bots/ml/model';
import type { GameState } from '../../src/types/poker';
import { normalizeChipDelta } from './targets';

export const SELFPLAY_DATASET_VERSION = 3;
export const SELFPLAY_TABLE_SIZES = [2, 3, 6] as const;
export const HEADER_BYTES = 16;

// Packed, no padding. Must stay in lockstep with training/train.py RECORD_DTYPE_V3.
// features, action, size, mask, reward, oldLogProb, oldValue, chipDelta, handId, seat, tableSize
export const RECORD_BYTES =
  ML_FEATURE_COUNT * 4 + 1 + 4 + ML_ACTIONS.length + 4 + 4 + 4 + 4 + 4 + 1 + 1;

export type SelfPlayRecord = {
  features: Float32Array;
  action: number;
  size: number;
  mask: Uint8Array;
  reward: number;
  oldLogProb: number;
  oldValue: number;
  chipDelta: number;
  handId: number;
  seat: number;
  tableSize: number;
};

type PendingDecision = {
  seat: number;
  features: Float32Array;
  action: number;
  size: number;
  mask: Uint8Array;
  oldLogProb: number;
  oldValue: number;
  handId: number;
};

export type SelfPlayStats = {
  hands: number;
  decisions: number;
  fallback: number;
  tableCounts: Record<string, number>;
  actionCounts: Record<string, number>;
  meanAbsDelta: number;
  meanReward: number;
  explore: SelfPlayExploreConfig;
};

export type SelfPlayGenerateOptions = {
  hands: number;
  worker: number;
  seed: number;
  outPath: string;
  primaryModel: ExportedPolicyModel;
  pool: ExportedPolicyModel[];
  primaryShare: number;
  explore: SelfPlayExploreConfig;
  startStack: number;
  smallBlind: number;
  bigBlind: number;
};

function emptyStats(explore: SelfPlayExploreConfig): SelfPlayStats {
  return {
    hands: 0,
    decisions: 0,
    fallback: 0,
    tableCounts: { '2': 0, '3': 0, '6': 0 },
    actionCounts: { fold: 0, check: 0, call: 0, wager: 0, 'all-in': 0 },
    meanAbsDelta: 0,
    meanReward: 0,
    explore,
  };
}

export function tableSizeForHand(hand: number): number {
  return SELFPLAY_TABLE_SIZES[hand % SELFPLAY_TABLE_SIZES.length]!;
}

export function loadPolicyModel(modelPath: string): ExportedPolicyModel {
  const raw = fs.readFileSync(modelPath, 'utf8');
  return JSON.parse(raw) as ExportedPolicyModel;
}

export function writeSelfPlayHeader(fd: number): void {
  const header = Buffer.alloc(HEADER_BYTES);
  header.write('LPTR', 0, 'ascii');
  header.writeUInt32LE(SELFPLAY_DATASET_VERSION, 4);
  header.writeUInt32LE(ML_FEATURE_COUNT, 8);
  header.writeUInt32LE(ML_ACTIONS.length, 12);
  fs.writeSync(fd, header);
}

export function writeSelfPlayRecord(fd: number, scratch: Buffer, record: SelfPlayRecord): void {
  let offset = 0;
  for (let i = 0; i < record.features.length; i++) {
    scratch.writeFloatLE(record.features[i]!, offset);
    offset += 4;
  }
  scratch.writeUInt8(record.action, offset++);
  scratch.writeFloatLE(record.size, offset);
  offset += 4;
  for (let i = 0; i < record.mask.length; i++) scratch.writeUInt8(record.mask[i]!, offset++);
  scratch.writeFloatLE(record.reward, offset);
  offset += 4;
  scratch.writeFloatLE(record.oldLogProb, offset);
  offset += 4;
  scratch.writeFloatLE(record.oldValue, offset);
  offset += 4;
  scratch.writeFloatLE(record.chipDelta, offset);
  offset += 4;
  scratch.writeUInt32LE(record.handId >>> 0, offset);
  offset += 4;
  scratch.writeUInt8(record.seat, offset++);
  scratch.writeUInt8(record.tableSize, offset++);
  fs.writeSync(fd, scratch, 0, RECORD_BYTES);
}

export function playSelfPlayHand(opts: {
  seats: number;
  seed: number;
  rng: () => number;
  primary: ExportedPolicyModel;
  pool: ExportedPolicyModel[];
  primaryShare: number;
  explore: SelfPlayExploreConfig;
  startStack?: number;
  smallBlind?: number;
  bigBlind?: number;
  handId?: number;
}): { records: SelfPlayRecord[]; fallback: number; state: GameState } {
  const startStack = opts.startStack ?? 400;
  const smallBlind = opts.smallBlind ?? 2;
  const bigBlind = opts.bigBlind ?? 4;
  const models = assignSeatModels(opts.seats, opts.primary, opts.pool, opts.rng, opts.primaryShare);

  let state = createGame({ smallBlind, bigBlind, maxSeats: opts.seats, seed: opts.seed });
  const starting: number[] = [];
  for (let seat = 0; seat < opts.seats; seat++) {
    starting.push(startStack);
    state = sitPlayer(state, seat, {
      playerId: `sp-${seat}`,
      name: `SelfPlay ${seat}`,
      stack: startStack,
      isBot: true,
      botPersona: 'ml',
    });
  }
  state = startHand(state, opts.seed >>> 0);

  const pending: PendingDecision[] = [];
  let fallback = 0;
  let actions = 0;
  while (state.street !== 'complete') {
    if (state.currentSeat == null) throw new Error('Self-play hand stalled without a current seat');
    if (++actions > 400) throw new Error(`Self-play hand exceeded 400 actions at seed ${opts.seed}`);

    const seat = state.currentSeat;
    const legal = getLegalActions(state);
    if (!legal.length) throw new Error(`Self-play actor ${seat} had no legal actions`);

    const sample = sampleMlExplore(models[seat]!, state, seat, legal, opts.rng, opts.explore);
    const legalized = legalizeBotDecision(sample.decision, legal, state.seats[seat]!.stack);
    const target = decisionToTrainingTarget(legalized, legal);
    if (sample.fallback || /fallback/i.test(legalized.reason)) fallback += 1;
    // PPO oldLogProb is the legalized action under the explore mix, not T=1 softmax.
    const oldLogProb = Math.log(Math.max(1e-8, sample.probabilities[target.action] ?? 0));

    pending.push({
      seat,
      features: sample.features,
      action: target.action,
      size: target.size,
      mask: sample.mask,
      oldLogProb,
      oldValue: sample.value,
      handId: (opts.handId ?? opts.seed) >>> 0,
    });
    state = applyAction(state, legalized.type, legalized.amount);
  }

  const records: SelfPlayRecord[] = pending.map((row) => {
    const end = state.seats[row.seat]?.stack ?? 0;
    const chipDelta = end - (starting[row.seat] ?? startStack);
    return {
      ...row,
      reward: normalizeChipDelta(chipDelta, starting[row.seat] ?? startStack),
      chipDelta,
      tableSize: opts.seats,
    };
  });

  return { records, fallback, state };
}

export function generateSelfPlayDataset(opts: SelfPlayGenerateOptions): SelfPlayStats {
  fs.mkdirSync(path.dirname(opts.outPath), { recursive: true });
  const fd = fs.openSync(opts.outPath, 'w');
  writeSelfPlayHeader(fd);
  fs.fsyncSync(fd);

  const rng = createRng(opts.seed);
  const scratch = Buffer.allocUnsafe(RECORD_BYTES);
  const stats = emptyStats(opts.explore);
  let absDeltaSum = 0;
  let rewardSum = 0;
  let deltaCount = 0;

  console.log(`[selfplay worker ${opts.worker}] starting ${opts.hands} hands -> ${opts.outPath}`);
  try {
    for (let hand = 0; hand < opts.hands; hand++) {
      const seats = tableSizeForHand(hand);
      const handSeed = (opts.seed + hand * 104729) >>> 0;
      const played = playSelfPlayHand({
        seats,
        seed: handSeed,
        rng,
        primary: opts.primaryModel,
        pool: opts.pool,
        primaryShare: opts.primaryShare,
        explore: opts.explore,
        startStack: opts.startStack,
        smallBlind: opts.smallBlind,
        bigBlind: opts.bigBlind,
        handId: ((opts.worker & 0xff) << 24) | (hand & 0xffffff),
      });

      for (const record of played.records) {
        writeSelfPlayRecord(fd, scratch, record);
        const name = ML_ACTIONS[record.action] ?? 'fold';
        stats.actionCounts[name] = (stats.actionCounts[name] ?? 0) + 1;
        absDeltaSum += Math.abs(record.chipDelta);
        rewardSum += record.reward;
        deltaCount += 1;
      }

      stats.hands += 1;
      stats.decisions += played.records.length;
      stats.fallback += played.fallback;
      stats.tableCounts[String(seats)] = (stats.tableCounts[String(seats)] ?? 0) + 1;

      if ((hand + 1) % 10 === 0) fs.fsyncSync(fd);
      if ((hand + 1) % 50 === 0 || hand + 1 === opts.hands) {
        console.log(`[selfplay worker ${opts.worker}] ${hand + 1}/${opts.hands} hands, ${stats.decisions} decisions`);
      }
    }
  } finally {
    fs.closeSync(fd);
  }

  stats.meanAbsDelta = deltaCount ? absDeltaSum / deltaCount : 0;
  stats.meanReward = deltaCount ? rewardSum / deltaCount : 0;
  const statsPath = opts.outPath.replace(/\.bin$/i, '.stats.json');
  fs.writeFileSync(statsPath, JSON.stringify(stats, null, 2));
  console.log(`[selfplay worker ${opts.worker}] wrote ${stats.decisions} records to ${opts.outPath}`);
  return stats;
}

export function readSelfPlayShard(filePath: string): SelfPlayRecord[] {
  const buf = fs.readFileSync(filePath);
  if (buf.length < HEADER_BYTES) throw new Error(`${filePath}: truncated header`);
  if (buf.subarray(0, 4).toString('ascii') !== 'LPTR') throw new Error(`${filePath}: bad magic`);
  const version = buf.readUInt32LE(4);
  if (version !== SELFPLAY_DATASET_VERSION) throw new Error(`${filePath}: expected version ${SELFPLAY_DATASET_VERSION}, got ${version}`);
  const records: SelfPlayRecord[] = [];
  for (let offset = HEADER_BYTES; offset + RECORD_BYTES <= buf.length; offset += RECORD_BYTES) {
    const features = new Float32Array(ML_FEATURE_COUNT);
    let cursor = offset;
    for (let i = 0; i < ML_FEATURE_COUNT; i++) {
      features[i] = buf.readFloatLE(cursor);
      cursor += 4;
    }
    const action = buf.readUInt8(cursor++);
    const size = buf.readFloatLE(cursor);
    cursor += 4;
    const mask = new Uint8Array(ML_ACTIONS.length);
    for (let i = 0; i < ML_ACTIONS.length; i++) mask[i] = buf.readUInt8(cursor++);
    const reward = buf.readFloatLE(cursor);
    cursor += 4;
    const oldLogProb = buf.readFloatLE(cursor);
    cursor += 4;
    const oldValue = buf.readFloatLE(cursor);
    cursor += 4;
    const chipDelta = buf.readFloatLE(cursor);
    cursor += 4;
    const handId = buf.readUInt32LE(cursor);
    cursor += 4;
    const seat = buf.readUInt8(cursor++);
    const tableSize = buf.readUInt8(cursor++);
    records.push({
      features,
      action,
      size,
      mask,
      reward,
      oldLogProb,
      oldValue,
      chipDelta,
      handId,
      seat,
      tableSize,
    });
  }
  return records;
}

export function parseSelfPlayEnv(env: NodeJS.ProcessEnv = process.env): SelfPlayGenerateOptions {
  const primaryPath = env.SELFPLAY_MODEL || path.join('training', 'out', 'policy-v1.json');
  const poolPaths = (env.SELFPLAY_POOL || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  const primaryModel = loadPolicyModel(primaryPath);
  const pool = poolPaths.length
    ? poolPaths.map((item) => loadPolicyModel(item))
    : [primaryModel];

  return {
    hands: Math.max(1, Number(env.SELFPLAY_HANDS || 1000)),
    worker: Math.max(0, Number(env.SELFPLAY_WORKER || 0)),
    seed: Math.max(1, Number(env.SELFPLAY_SEED || 1337)) + Math.max(0, Number(env.SELFPLAY_WORKER || 0)) * 1_000_003,
    outPath: env.SELFPLAY_OUT || path.join('training', 'data', `selfplay.part-${env.SELFPLAY_WORKER || 0}.bin`),
    primaryModel,
    pool,
    primaryShare: Math.min(1, Math.max(0, Number(env.SELFPLAY_PRIMARY_SHARE || 1))),
    explore: {
      temperature: Number(env.SELFPLAY_TEMPERATURE || DEFAULT_SELFPLAY_EXPLORE.temperature),
      epsilon: Number(env.SELFPLAY_EPSILON || DEFAULT_SELFPLAY_EXPLORE.epsilon),
      sizeJitter: Number(env.SELFPLAY_SIZE_JITTER || DEFAULT_SELFPLAY_EXPLORE.sizeJitter),
    },
    startStack: Math.max(20, Number(env.SELFPLAY_STACK || 400)),
    smallBlind: Math.max(1, Number(env.SELFPLAY_SB || 2)),
    bigBlind: Math.max(2, Number(env.SELFPLAY_BB || 4)),
  };
}

export function generateSelfPlayFromEnv(env: NodeJS.ProcessEnv = process.env): SelfPlayStats {
  return generateSelfPlayDataset(parseSelfPlayEnv(env));
}
