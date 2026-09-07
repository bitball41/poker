import fs from 'node:fs';
import path from 'node:path';
import { test } from 'vitest';
import { applyAction, createGame, getLegalActions, sitPlayer, startHand } from '../src/engine/game';
import { createRng } from '../src/engine/rng';
import { decideTournamentAction } from '../src/bots/tournamentPolicy';
import { legalizeBotDecision } from '../src/bots/legalize';
import {
  decisionToTrainingTarget,
  encodeBotFeatures,
  legalActionMask,
  ML_ACTIONS,
  ML_FEATURE_COUNT,
} from '../src/bots/ml/features';
import type { GameState } from '../src/types/poker';

const HEADER_BYTES = 16;
const RECORD_BYTES = ML_FEATURE_COUNT * 4 + 1 + 4 + ML_ACTIONS.length + 4;
const BLIND_LEVELS = [
  [2, 4],
  [4, 8],
  [8, 16],
  [12, 24],
  [20, 40],
] as const;

type PendingRecord = {
  seat: number;
  features: Float32Array;
  action: number;
  size: number;
  mask: Uint8Array;
};

function randomStack(rng: () => number): number {
  if (rng() < 0.6) return 300 + Math.floor(rng() * 201);
  return rng() < 0.5
    ? 140 + Math.floor(rng() * 160)
    : 520 + Math.floor(rng() * 321);
}

function writeHeader(fd: number): void {
  const header = Buffer.alloc(HEADER_BYTES);
  header.write('LPTR', 0, 'ascii');
  header.writeUInt32LE(1, 4);
  header.writeUInt32LE(ML_FEATURE_COUNT, 8);
  header.writeUInt32LE(ML_ACTIONS.length, 12);
  fs.writeSync(fd, header);
}

function encodeRecord(record: PendingRecord, reward: number): Buffer {
  const out = Buffer.allocUnsafe(RECORD_BYTES);
  let offset = 0;
  for (let i = 0; i < record.features.length; i++) {
    out.writeFloatLE(record.features[i], offset);
    offset += 4;
  }
  out.writeUInt8(record.action, offset++);
  out.writeFloatLE(record.size, offset);
  offset += 4;
  for (let i = 0; i < record.mask.length; i++) out.writeUInt8(record.mask[i], offset++);
  out.writeFloatLE(reward, offset);
  return out;
}

function makeHand(rng: () => number, seed: number): { state: GameState; starting: number[] } {
  const forcedSeats = Number(process.env.TRAIN_SEATS || 0);
  const seats = forcedSeats >= 2 && forcedSeats <= 9
    ? Math.floor(forcedSeats)
    : 2 + Math.floor(rng() * 8);
  const [smallBlind, bigBlind] = BLIND_LEVELS[Math.floor(rng() * BLIND_LEVELS.length)];

  let state = createGame({ smallBlind, bigBlind, maxSeats: seats, seed });
  const starting: number[] = [];
  for (let seat = 0; seat < seats; seat++) {
    const stack = randomStack(rng);
    starting.push(stack);
    state = sitPlayer(state, seat, {
      playerId: `train-${seat}`,
      name: `Train ${seat}`,
      stack,
      isBot: true,
      botPersona: 'quill',
    });
  }
  return { state: startHand(state, seed ^ 0x6d2b79f5), starting };
}

const enabled = process.env.TRAIN_GENERATE === '1';

test.skipIf(!enabled)(
  'generate bootstrap poker training records',
  () => {
    const hands = Math.max(1, Number(process.env.TRAIN_HANDS || 1000));
    const worker = Math.max(0, Number(process.env.TRAIN_WORKER || 0));
    const seed = Math.max(1, Number(process.env.TRAIN_SEED || 1337)) + worker * 1_000_003;
    const outPath = process.env.TRAIN_OUT || path.join('training', 'data', `bootstrap.part-${worker}.bin`);
    fs.mkdirSync(path.dirname(outPath), { recursive: true });

    const fd = fs.openSync(outPath, 'w');
    writeHeader(fd);
    const rng = createRng(seed);
    let recordsWritten = 0;

    try {
      for (let hand = 0; hand < hands; hand++) {
        const handSeed = (seed + hand * 104729) >>> 0;
        const { state: initial, starting } = makeHand(rng, handSeed);
        let state = initial;
        const pending: PendingRecord[] = [];
        let actions = 0;

        while (state.street !== 'complete') {
          if (state.currentSeat == null) throw new Error('Training hand stalled without a current seat');
          if (++actions > 300) throw new Error(`Training hand exceeded 300 actions at hand ${hand}`);

          const seat = state.currentSeat;
          const legal = getLegalActions(state);
          if (!legal.length) throw new Error(`Training actor ${seat} had no legal actions`);
          const proposed = decideTournamentAction(state, seat, 'quill', legal);
          const decision = legalizeBotDecision(proposed, legal, state.seats[seat].stack);
          const target = decisionToTrainingTarget(decision, legal);
          pending.push({
            seat,
            features: encodeBotFeatures(state, seat),
            action: target.action,
            size: target.size,
            mask: legalActionMask(legal),
          });
          state = applyAction(state, decision.type, decision.amount);
        }

        const averageStart = Math.max(1, starting.reduce((a, b) => a + b, 0) / starting.length);
        const buffers = pending.map((record) => {
          const end = state.seats[record.seat]?.stack ?? 0;
          const delta = end - (starting[record.seat] ?? 0);
          const reward = Math.max(-1, Math.min(1, delta / averageStart));
          return encodeRecord(record, reward);
        });
        fs.writeSync(fd, Buffer.concat(buffers));
        recordsWritten += buffers.length;

        if ((hand + 1) % 100 === 0 || hand + 1 === hands) {
          console.log(`[train worker ${worker}] ${hand + 1}/${hands} hands, ${recordsWritten} decisions`);
        }
      }
    } finally {
      fs.closeSync(fd);
    }

    console.log(`[train worker ${worker}] wrote ${recordsWritten} records to ${outPath}`);
  },
  24 * 60 * 60 * 1000,
);
