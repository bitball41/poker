import { describe, expect, it } from 'vitest';
import { applyAction, createGame, getLegalActions, sitPlayer, startHand } from '../engine/game';
import { parseCard } from '../engine/cards';
import { decideAction } from './decision';
import type { ExportedPolicyModel } from './ml/model';
import { getShippedPolicy } from './ml/runtime';

function tinyModel(policyBias = [0, 0, 0, 0, 0]): ExportedPolicyModel {
  const zeros = (n: number) => Array(n).fill(0);
  const layer = (input: number, output: number, activation: 'relu' | 'linear' = 'linear', bias?: number[]) => ({
    input,
    output,
    weights: zeros(input * output),
    bias: bias ?? zeros(output),
    activation,
  });
  return {
    version: 1,
    featureCount: 160,
    actionCount: 5,
    trunk: [layer(160, 8, 'relu'), layer(8, 8, 'relu'), layer(8, 4, 'relu')],
    policy: layer(4, 5, 'linear', policyBias),
    value: layer(4, 1),
    size: layer(4, 1),
  };
}

function headsUp(seed: number) {
  let game = createGame({ smallBlind: 2, bigBlind: 4, maxSeats: 2, seed });
  game = sitPlayer(game, 0, { playerId: 'a', name: 'A', stack: 400, isBot: true, botPersona: 'rook' });
  game = sitPlayer(game, 1, { playerId: 'b', name: 'B', stack: 400, isBot: true, botPersona: 'harbor' });
  return startHand(game, seed);
}

describe('decideAction ML wiring', () => {
  it('loads shipped policy-v1, not a missing or v2 checkpoint', () => {
    const model = getShippedPolicy();
    expect(model).not.toBeNull();
    expect(model?.version).toBe(1);
    expect(model?.featureCount).toBe(160);
    expect(model?.actionCount).toBe(5);
  });

  it('uses greedy ML and ignores persona for the actual action', () => {
    const game = headsUp(17);
    const seat = game.currentSeat!;
    const legal = getLegalActions(game);
    const rook = decideAction(game, seat, 'rook', legal);
    const harbor = decideAction(game, seat, 'harbor', legal);
    expect(rook.type).toBe(harbor.type);
    expect(rook.amount).toBe(harbor.amount);
    expect(legal.some((action) => action.type === rook.type)).toBe(true);
  });

  it('falls back to the tournament heuristic when inference explodes', () => {
    const game = headsUp(21);
    const seat = game.currentSeat!;
    game.seats[seat]!.holeCards = [parseCard('7h'), parseCard('2c')];
    const legal = getLegalActions(game);
    const broken = tinyModel();
    broken.version = 2 as ExportedPolicyModel['version'];
    const fallback = decideAction(game, seat, 'rook', legal, { model: broken });
    const heuristic = decideAction(game, seat, 'rook', legal, { model: null });
    expect(fallback.type).toBe(heuristic.type);
    expect(fallback.amount).toBe(heuristic.amount);
    expect(legal.some((action) => action.type === fallback.type)).toBe(true);
  });

  it('legalizes a forced all-fold tiny model into a legal engine action', () => {
    const game = headsUp(5);
    const seat = game.currentSeat!;
    const legal = getLegalActions(game);
    const decision = decideAction(game, seat, 'mira', legal, { model: tinyModel([8, 0, 0, 0, 0]) });
    expect(legal.some((action) => action.type === decision.type)).toBe(true);
  });

  it('plays real all-bot hands without illegal actions or a wager-only collapse', () => {
    const counts = { fold: 0, check: 0, call: 0, bet: 0, raise: 0, 'all-in': 0 };
    let actions = 0;
    for (let hand = 0; hand < 8; hand++) {
      let game = createGame({ smallBlind: 2, bigBlind: 4, maxSeats: 6, seed: 1000 + hand });
      for (let seat = 0; seat < 6; seat++) {
        game = sitPlayer(game, seat, {
          playerId: `bot-${seat}`,
          name: `Bot ${seat}`,
          stack: 400,
          isBot: true,
          botPersona: seat % 2 === 0 ? 'rook' : 'harbor',
        });
      }
      game = startHand(game, 2000 + hand);
      let steps = 0;
      while (game.street !== 'complete') {
        const seat = game.currentSeat;
        if (seat == null) throw new Error('hand stalled');
        const legal = getLegalActions(game);
        expect(legal.length).toBeGreaterThan(0);
        const decision = decideAction(game, seat, game.seats[seat]!.botPersona ?? 'mira', legal);
        expect(legal.some((action) => action.type === decision.type)).toBe(true);
        if (decision.type === 'bet' || decision.type === 'raise') {
          const wager = legal.find((action) => action.type === decision.type);
          expect(decision.amount).toBeGreaterThanOrEqual(wager?.min ?? 1);
          expect(decision.amount).toBeLessThanOrEqual(wager?.max ?? decision.amount ?? 0);
        }
        counts[decision.type] += 1;
        actions += 1;
        game = applyAction(game, decision.type, decision.amount);
        if (++steps > 400) throw new Error(`hand ${hand} ran away`);
      }
    }
    expect(actions).toBeGreaterThan(20);
    const wagers = counts.bet + counts.raise;
    expect(wagers).toBeLessThan(actions);
    expect(counts.fold + counts.check + counts.call).toBeGreaterThan(0);
  });
});
