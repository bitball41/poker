import type { BotDecision, GameState, LegalAction } from '../src/types/poker';
import { applyAction, createGame, getLegalActions, sitPlayer, startHand } from '../src/engine/game';
import { createRng } from '../src/engine/rng';
import { legalizeBotDecision } from '../src/bots/legalize';
import { decideTournamentAction } from '../src/bots/tournamentPolicy';
import { getPosition, type PositionLabel } from '../src/bots/position';
import {
  decideMlAction,
  type ExportedPolicyModel,
} from '../src/bots/ml/model';
import { encodeBotFeatures } from '../src/bots/ml/features';

export const ACTION_BUCKETS = ['fold', 'check', 'call', 'wager', 'all-in'] as const;
export type ActionBucket = (typeof ACTION_BUCKETS)[number];

export interface EvalAgent {
  id: string;
  decide: (
    state: GameState,
    seatIndex: number,
    legal: LegalAction[],
  ) => { decision: BotDecision; latencyMs: number };
}

export interface HandRecord {
  tableSize: number;
  seed: number;
  mlSeat: number;
  opponent: 'heuristic' | 'checkpoint' | 'model';
  startStack: number;
  endStack: number;
  delta: number;
  busted: boolean;
  won: boolean;
  lost: boolean;
  tied: boolean;
  potWinner: boolean;
  handsPlayed: number;
  handsSurvived: number;
  position: PositionLabel;
  mlActions: number;
  fallbackCount: number;
  illegalPrevented: number;
  actionCounts: Record<ActionBucket, number>;
  wagerAmountSum: number;
  wagerCount: number;
  latencySumMs: number;
  latencyCount: number;
  latenciesMs: number[];
}

export interface MeanCI {
  mean: number;
  lo: number;
  hi: number;
}

export interface EvalSummary {
  games: number;
  wins: number;
  losses: number;
  ties: number;
  winRate: number;
  avgEndStack: number;
  avgDelta: number;
  deltaCI: MeanCI;
  bustRate: number;
  avgHandsSurvived: number;
  actionCounts: Record<ActionBucket, number>;
  actionFreq: Record<ActionBucket, number>;
  avgWagerSize: number;
  fallbackCount: number;
  fallbackRate: number;
  illegalPrevented: number;
  inference: { count: number; avgMs: number; p50Ms: number; p95Ms: number };
  byTableSize: Record<string, Omit<EvalSummary, 'byTableSize' | 'byPosition' | 'byOpponent'>>;
  byPosition: Record<string, { games: number; wins: number; winRate: number; avgDelta: number; deltaCI: MeanCI }>;
  byOpponent: Record<string, { games: number; wins: number; winRate: number; avgDelta: number; deltaCI: MeanCI }>;
}

export function bucketAction(type: BotDecision['type']): ActionBucket {
  if (type === 'bet' || type === 'raise') return 'wager';
  if (type === 'all-in') return 'all-in';
  if (type === 'call') return 'call';
  if (type === 'check') return 'check';
  return 'fold';
}

function emptyCounts(): Record<ActionBucket, number> {
  return { fold: 0, check: 0, call: 0, wager: 0, 'all-in': 0 };
}

export function bootstrapMeanCI(values: number[], samples = 2000, seed = 1337): MeanCI {
  if (!values.length) return { mean: 0, lo: 0, hi: 0 };
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  if (values.length === 1 || values.every((value) => value === values[0])) {
    return { mean, lo: mean, hi: mean };
  }
  const rng = createRng(seed);
  const means = new Array<number>(samples);
  for (let sample = 0; sample < samples; sample++) {
    let sum = 0;
    for (let i = 0; i < values.length; i++) {
      sum += values[Math.floor(rng() * values.length)]!;
    }
    means[sample] = sum / values.length;
  }
  means.sort((a, b) => a - b);
  return {
    mean,
    lo: means[Math.floor(0.025 * samples)]!,
    hi: means[Math.min(samples - 1, Math.floor(0.975 * samples))]!,
  };
}

function percentile(sorted: number[], p: number): number {
  if (!sorted.length) return 0;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx];
}

export function createHeuristicAgent(personaId = 'quill'): EvalAgent {
  return {
    id: `heuristic:${personaId}`,
    decide(state, seatIndex, legal) {
      const start = performance.now();
      const decision = decideTournamentAction(state, seatIndex, personaId, legal);
      return { decision, latencyMs: performance.now() - start };
    },
  };
}

export function createMlAgent(model: ExportedPolicyModel, id = 'ml'): EvalAgent {
  return {
    id,
    decide(state, seatIndex, legal) {
      const start = performance.now();
      const decision = decideMlAction(model, state, seatIndex, legal);
      return { decision, latencyMs: performance.now() - start };
    },
  };
}

/** Always proposes an illegal wager so the legalize boundary can be tested. */
export function createChaosAgent(): EvalAgent {
  return {
    id: 'chaos',
    decide() {
      return {
        decision: { type: 'bet', amount: -99, reason: 'chaos illegal', confidence: 1 },
        latencyMs: 0,
      };
    },
  };
}

function occupiedSeatIndexes(state: GameState): number[] {
  return state.seats.filter((s) => !s.sittingOut && s.playerId != null).map((s) => s.seatIndex);
}

export function playHand(opts: {
  seats: number;
  seed: number;
  mlSeat: number;
  startStack?: number;
  smallBlind?: number;
  bigBlind?: number;
  mlAgent: EvalAgent;
  otherAgent: EvalAgent;
  opponent: HandRecord['opponent'];
}): HandRecord {
  const startStack = opts.startStack ?? 400;
  const smallBlind = opts.smallBlind ?? 2;
  const bigBlind = opts.bigBlind ?? 4;
  const counts = emptyCounts();
  let fallbackCount = 0;
  let illegalPrevented = 0;
  let mlActions = 0;
  let wagerAmountSum = 0;
  let wagerCount = 0;
  let latencySumMs = 0;
  let latencyCount = 0;
  const latenciesMs: number[] = [];

  let state = createGame({ smallBlind, bigBlind, maxSeats: opts.seats, seed: opts.seed });
  for (let seat = 0; seat < opts.seats; seat++) {
    state = sitPlayer(state, seat, {
      playerId: seat === opts.mlSeat ? 'ml' : `opp-${seat}`,
      name: seat === opts.mlSeat ? 'ML' : `Opp ${seat}`,
      stack: startStack,
      isBot: true,
      botPersona: seat === opts.mlSeat ? 'ml' : 'quill',
    });
  }
  state = startHand(state, opts.seed >>> 0);
  const occupied = occupiedSeatIndexes(state);
  const position = getPosition(opts.mlSeat, state.button, occupied);

  let actions = 0;
  while (state.street !== 'complete') {
    if (state.currentSeat == null) throw new Error('Eval hand stalled without a current seat');
    if (++actions > 400) throw new Error(`Eval hand exceeded 400 actions at seed ${opts.seed}`);

    const seat = state.currentSeat;
    const legal = getLegalActions(state);
    if (!legal.length) throw new Error(`Eval actor ${seat} had no legal actions`);

    const agent = seat === opts.mlSeat ? opts.mlAgent : opts.otherAgent;
    const { decision: proposed, latencyMs } = agent.decide(state, seat, legal);
    const legalized = legalizeBotDecision(proposed, legal, state.seats[seat].stack);
    const fallback = /fallback/i.test(legalized.reason) || /fallback/i.test(proposed.reason);

    if (seat === opts.mlSeat) {
      mlActions += 1;
      latencySumMs += latencyMs;
      latencyCount += 1;
      latenciesMs.push(latencyMs);
      if (fallback) fallbackCount += 1;
      const bucket = bucketAction(legalized.type);
      counts[bucket] += 1;
      if (bucket === 'wager' && legalized.amount != null) {
        wagerAmountSum += legalized.amount;
        wagerCount += 1;
      }
    }

    try {
      state = applyAction(state, legalized.type, legalized.amount);
    } catch {
      illegalPrevented += 1;
      const safe = legalizeBotDecision(
        { type: 'fold', reason: 'eval crash fallback', confidence: 0 },
        legal,
        state.seats[seat].stack,
      );
      state = applyAction(state, safe.type, safe.amount);
    }
  }

  const endStack = state.seats[opts.mlSeat]?.stack ?? 0;
  const delta = endStack - startStack;
  const potWinner = (state.winners ?? []).some((w) => w.seat === opts.mlSeat);

  return {
    tableSize: opts.seats,
    seed: opts.seed,
    mlSeat: opts.mlSeat,
    opponent: opts.opponent,
    startStack,
    endStack,
    delta,
    busted: endStack <= 0,
    won: delta > 0,
    lost: delta < 0,
    tied: delta === 0,
    potWinner,
    handsPlayed: 1,
    handsSurvived: endStack > 0 ? 1 : 0,
    position,
    mlActions,
    fallbackCount,
    illegalPrevented,
    actionCounts: counts,
    wagerAmountSum,
    wagerCount,
    latencySumMs,
    latencyCount,
    latenciesMs,
  };
}

export function pairedHandPlan(tableSize: number, games: number, seed: number): Array<{ seed: number; mlSeat: number }> {
  const plan: Array<{ seed: number; mlSeat: number }> = [];
  for (let i = 0; i < games; i++) {
    const deal = (seed + Math.floor(i / tableSize) * 104729) >>> 0;
    plan.push({ seed: deal, mlSeat: i % tableSize });
  }
  return plan;
}

export function runPairedMatchup(opts: {
  tableSize: number;
  games: number;
  seed: number;
  mlAgent: EvalAgent;
  otherAgent: EvalAgent;
  opponent: HandRecord['opponent'];
  startStack?: number;
}): HandRecord[] {
  return pairedHandPlan(opts.tableSize, opts.games, opts.seed).map((item) => playHand({
    seats: opts.tableSize,
    seed: item.seed,
    mlSeat: item.mlSeat,
    mlAgent: opts.mlAgent,
    otherAgent: opts.otherAgent,
    opponent: opts.opponent,
    startStack: opts.startStack,
  }));
}

export function runPairedMatchupSlice(opts: {
  tableSize: number;
  totalGames: number;
  seed: number;
  sliceStart: number;
  sliceCount: number;
  mlAgent: EvalAgent;
  otherAgent: EvalAgent;
  opponent: HandRecord['opponent'];
  startStack?: number;
}): HandRecord[] {
  const plan = pairedHandPlan(opts.tableSize, opts.totalGames, opts.seed)
    .slice(opts.sliceStart, opts.sliceStart + opts.sliceCount);
  return plan.map((item) => playHand({
    seats: opts.tableSize,
    seed: item.seed,
    mlSeat: item.mlSeat,
    mlAgent: opts.mlAgent,
    otherAgent: opts.otherAgent,
    opponent: opts.opponent,
    startStack: opts.startStack,
  }));
}

function summarizeRecords(records: HandRecord[]): Omit<EvalSummary, 'byTableSize' | 'byPosition' | 'byOpponent'> {
  const games = records.length;
  const wins = records.filter((r) => r.won).length;
  const losses = records.filter((r) => r.lost).length;
  const ties = records.filter((r) => r.tied).length;
  const actionCounts = emptyCounts();
  let fallbackCount = 0;
  let illegalPrevented = 0;
  let wagerAmountSum = 0;
  let wagerCount = 0;
  let endSum = 0;
  let deltaSum = 0;
  let busts = 0;
  let survived = 0;
  let mlActions = 0;
  const latencies: number[] = [];

  for (const record of records) {
    endSum += record.endStack;
    deltaSum += record.delta;
    if (record.busted) busts += 1;
    survived += record.handsSurvived;
    fallbackCount += record.fallbackCount;
    illegalPrevented += record.illegalPrevented;
    mlActions += record.mlActions;
    wagerAmountSum += record.wagerAmountSum;
    wagerCount += record.wagerCount;
    for (const bucket of ACTION_BUCKETS) actionCounts[bucket] += record.actionCounts[bucket];
    latencies.push(...record.latenciesMs);
  }

  latencies.sort((a, b) => a - b);
  const actionTotal = Math.max(1, Object.values(actionCounts).reduce((a, b) => a + b, 0));
  const actionFreq = emptyCounts();
  for (const bucket of ACTION_BUCKETS) actionFreq[bucket] = actionCounts[bucket] / actionTotal;

  return {
    games,
    wins,
    losses,
    ties,
    winRate: games ? wins / games : 0,
    avgEndStack: games ? endSum / games : 0,
    avgDelta: games ? deltaSum / games : 0,
    deltaCI: bootstrapMeanCI(records.map((record) => record.delta)),
    bustRate: games ? busts / games : 0,
    avgHandsSurvived: games ? survived / games : 0,
    actionCounts,
    actionFreq,
    avgWagerSize: wagerCount ? wagerAmountSum / wagerCount : 0,
    fallbackCount,
    fallbackRate: mlActions ? fallbackCount / mlActions : 0,
    illegalPrevented,
    inference: {
      count: latencies.length,
      avgMs: latencies.length ? latencies.reduce((a, b) => a + b, 0) / latencies.length : 0,
      p50Ms: percentile(latencies, 50),
      p95Ms: percentile(latencies, 95),
    },
  };
}

export function aggregateResults(records: HandRecord[]): EvalSummary {
  const base = summarizeRecords(records);
  const byTableSize: EvalSummary['byTableSize'] = {};
  const sizes = [...new Set(records.map((r) => r.tableSize))].sort((a, b) => a - b);
  for (const size of sizes) {
    byTableSize[String(size)] = summarizeRecords(records.filter((r) => r.tableSize === size));
  }

  const byPosition: EvalSummary['byPosition'] = {};
  const posDeltas = new Map<string, number[]>();
  for (const record of records) {
    const key = record.position;
    const bucket = byPosition[key] ?? { games: 0, wins: 0, winRate: 0, avgDelta: 0, deltaCI: { mean: 0, lo: 0, hi: 0 } };
    bucket.games += 1;
    if (record.won) bucket.wins += 1;
    bucket.avgDelta += record.delta;
    byPosition[key] = bucket;
    const list = posDeltas.get(key) ?? [];
    list.push(record.delta);
    posDeltas.set(key, list);
  }
  for (const [key, bucket] of Object.entries(byPosition)) {
    bucket.winRate = bucket.games ? bucket.wins / bucket.games : 0;
    bucket.avgDelta = bucket.games ? bucket.avgDelta / bucket.games : 0;
    bucket.deltaCI = bootstrapMeanCI(posDeltas.get(key) ?? []);
  }

  const byOpponent: EvalSummary['byOpponent'] = {};
  const oppDeltas = new Map<string, number[]>();
  for (const record of records) {
    const key = record.opponent;
    const bucket = byOpponent[key] ?? { games: 0, wins: 0, winRate: 0, avgDelta: 0, deltaCI: { mean: 0, lo: 0, hi: 0 } };
    bucket.games += 1;
    if (record.won) bucket.wins += 1;
    bucket.avgDelta += record.delta;
    byOpponent[key] = bucket;
    const list = oppDeltas.get(key) ?? [];
    list.push(record.delta);
    oppDeltas.set(key, list);
  }
  for (const [key, bucket] of Object.entries(byOpponent)) {
    bucket.winRate = bucket.games ? bucket.wins / bucket.games : 0;
    bucket.avgDelta = bucket.games ? bucket.avgDelta / bucket.games : 0;
    bucket.deltaCI = bootstrapMeanCI(oppDeltas.get(key) ?? []);
  }

  return { ...base, byTableSize, byPosition, byOpponent };
}

export function featuresIgnoreHiddenCards(state: GameState, seatIndex: number): boolean {
  const before = Array.from(encodeBotFeatures(state, seatIndex));
  const mutated: GameState = {
    ...state,
    deck: [...state.deck].reverse(),
    seats: state.seats.map((seat) => ({
      ...seat,
      holeCards: seat.holeCards ? [...seat.holeCards] : null,
    })),
  };
  const opponent = mutated.seats.find((seat) => seat.seatIndex !== seatIndex && seat.holeCards?.length === 2);
  if (opponent?.holeCards) {
    opponent.holeCards = [
      { rank: 14, suit: 's' },
      { rank: 14, suit: 'h' },
    ];
  }
  const after = Array.from(encodeBotFeatures(mutated, seatIndex));
  return before.length === after.length && before.every((value, i) => value === after[i]);
}
