import { describe, expect, it } from 'vitest';
import { createGame, getLegalActions, sitPlayer, startHand } from '../src/engine/game';
import { decideMlAction } from '../src/bots/ml/model';
import type { ExportedPolicyModel } from '../src/bots/ml/model';
import {
  aggregateResults,
  bootstrapMeanCI,
  createChaosAgent,
  createHeuristicAgent,
  featuresIgnoreHiddenCards,
  pairedHandPlan,
  playHand,
  type HandRecord,
} from './harness';

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

function blankRecord(over: Partial<HandRecord> = {}): HandRecord {
  return {
    tableSize: 2,
    seed: 1,
    mlSeat: 0,
    opponent: 'heuristic',
    startStack: 400,
    endStack: 400,
    delta: 0,
    busted: false,
    won: false,
    lost: false,
    tied: true,
    potWinner: false,
    handsPlayed: 1,
    handsSurvived: 1,
    position: 'BTN',
    mlActions: 1,
    fallbackCount: 0,
    illegalPrevented: 0,
    actionCounts: { fold: 1, check: 0, call: 0, wager: 0, 'all-in': 0 },
    wagerAmountSum: 0,
    wagerCount: 0,
    latencySumMs: 1,
    latencyCount: 1,
    latenciesMs: [1],
    ...over,
  };
}

describe('eval harness', () => {
  it('is deterministic for a fixed seed', () => {
    const heuristic = createHeuristicAgent('quill');
    const opts = {
      seats: 2 as const,
      seed: 4242,
      mlSeat: 0,
      mlAgent: heuristic,
      otherAgent: heuristic,
      opponent: 'heuristic' as const,
    };
    const a = playHand(opts);
    const b = playHand(opts);
    expect(a.endStack).toBe(b.endStack);
    expect(a.delta).toBe(b.delta);
    expect(a.actionCounts).toEqual(b.actionCounts);
    expect(a.busted).toBe(b.busted);
  });

  it('does not leak hidden opponent cards into ML decisions', () => {
    let game = createGame({ smallBlind: 2, bigBlind: 4, maxSeats: 3, seed: 9 });
    game = sitPlayer(game, 0, { playerId: 'a', name: 'A', stack: 400 });
    game = sitPlayer(game, 1, { playerId: 'b', name: 'B', stack: 400 });
    game = sitPlayer(game, 2, { playerId: 'c', name: 'C', stack: 400 });
    game = startHand(game, 13);
    const actor = game.currentSeat!;
    expect(featuresIgnoreHiddenCards(game, actor)).toBe(true);

    const model = tinyModel();
    const legal = getLegalActions(game);
    const first = decideMlAction(model, game, actor, legal);
    const scrambled = {
      ...game,
      deck: [...game.deck].reverse(),
      seats: game.seats.map((seat) => ({
        ...seat,
        holeCards: seat.holeCards ? [...seat.holeCards] as typeof seat.holeCards : null,
      })),
    };
    const opponent = scrambled.seats.find((seat) => seat.seatIndex !== actor && seat.holeCards?.length === 2)!;
    opponent.holeCards = [{ rank: 14, suit: 's' }, { rank: 14, suit: 'h' }];
    const second = decideMlAction(model, scrambled, actor, legal);
    expect(second).toEqual(first);
  });

  it('does not crash a game when an agent proposes illegal actions', () => {
    const chaos = createChaosAgent();
    expect(() => playHand({
      seats: 2,
      seed: 77,
      mlSeat: 0,
      mlAgent: chaos,
      otherAgent: chaos,
      opponent: 'heuristic',
    })).not.toThrow();

    const record = playHand({
      seats: 3,
      seed: 88,
      mlSeat: 1,
      mlAgent: chaos,
      otherAgent: chaos,
      opponent: 'heuristic',
    });
    expect(record.handsPlayed).toBe(1);
    expect(record.endStack).toBeGreaterThanOrEqual(0);
  });

  it('aggregates stats correctly', () => {
    const records = [
      blankRecord({ won: true, tied: false, delta: 40, endStack: 440, actionCounts: { fold: 0, check: 1, call: 0, wager: 1, 'all-in': 0 }, wagerCount: 1, wagerAmountSum: 20, fallbackCount: 1, mlActions: 2 }),
      blankRecord({ won: false, lost: true, tied: false, delta: -40, endStack: 360, busted: false, actionCounts: { fold: 1, check: 0, call: 0, wager: 0, 'all-in': 0 }, tableSize: 3, position: 'BB' }),
      blankRecord({ won: false, lost: true, tied: false, delta: -400, endStack: 0, busted: true, handsSurvived: 0, actionCounts: { fold: 0, check: 0, call: 0, wager: 0, 'all-in': 1 } }),
    ];
    const summary = aggregateResults(records);
    expect(summary.games).toBe(3);
    expect(summary.wins).toBe(1);
    expect(summary.losses).toBe(2);
    expect(summary.winRate).toBeCloseTo(1 / 3);
    expect(summary.avgDelta).toBeCloseTo((40 - 40 - 400) / 3);
    expect(summary.bustRate).toBeCloseTo(1 / 3);
    expect(summary.avgHandsSurvived).toBeCloseTo(2 / 3);
    expect(summary.actionCounts.fold).toBe(1);
    expect(summary.actionCounts.wager).toBe(1);
    expect(summary.actionCounts['all-in']).toBe(1);
    expect(summary.fallbackCount).toBe(1);
    expect(summary.byTableSize['2']?.games).toBe(2);
    expect(summary.byTableSize['3']?.games).toBe(1);
    expect(summary.byPosition.BTN?.games).toBe(2);
    expect(summary.byPosition.BB?.games).toBe(1);
    expect(summary.deltaCI.mean).toBeCloseTo(summary.avgDelta);
    expect(summary.deltaCI.lo).toBeLessThanOrEqual(summary.deltaCI.hi);
  });

  it('bootstraps a 95% CI for paired chip delta', () => {
    expect(bootstrapMeanCI([5, 5, 5])).toEqual({ mean: 5, lo: 5, hi: 5 });
    const ci = bootstrapMeanCI([-40, 0, 40, 20, -20]);
    expect(ci.mean).toBeCloseTo(0);
    expect(ci.lo).toBeLessThanOrEqual(ci.mean);
    expect(ci.hi).toBeGreaterThanOrEqual(ci.mean);
  });

  it('pairs seats so the same deal is reused across ML seats', () => {
    const plan = pairedHandPlan(2, 4, 1000);
    expect(plan).toEqual([
      { seed: 1000, mlSeat: 0 },
      { seed: 1000, mlSeat: 1 },
      { seed: (1000 + 104729) >>> 0, mlSeat: 0 },
      { seed: (1000 + 104729) >>> 0, mlSeat: 1 },
    ]);
  });
});
