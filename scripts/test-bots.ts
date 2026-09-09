import { evaluateHand, compareHands, CATEGORY_RANK } from '../src/bots/handStrength';
import { parseCard } from '../src/engine/cards';
import { createGame, sitPlayer, startHand, getLegalActions } from '../src/engine/game';
import { decideAction } from '../src/bots/decision';
import { decideTournamentAction } from '../src/bots/tournamentPolicy';
import { legalizeBotDecision } from '../src/bots/legalize';
import { potOdds } from '../src/bots/potOdds';
import { estimateEquity } from '../src/bots/equity';

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

function c(...ids: string[]) {
  return ids.map(parseCard);
}

console.log('— Hand ranking —');

const royal = evaluateHand(c('Ah', 'Kh', 'Qh', 'Jh', 'Th'));
assert(royal.category === 'royal-flush', `expected royal, got ${royal.category}`);

const wheel = evaluateHand(c('Ah', '2c', '3d', '4s', '5h'));
assert(wheel.category === 'straight' && wheel.kickers[0] === 5, `wheel failed: ${JSON.stringify(wheel)}`);

const trips = evaluateHand(c('9h', '9d', '9c', '2s', 'As'));
assert(trips.category === 'trips', `trips failed`);

const fh = evaluateHand(c('9h', '9d', '9c', 'As', 'Ad'));
assert(fh.category === 'full-house', `FH failed`);

const a = evaluateHand(c('Ah', 'Ad', 'Kc', '2s', '3d'));
const b = evaluateHand(c('Kh', 'Kd', 'Ac', '2s', '3d'));
assert(compareHands(a, b) > 0, 'AA should beat KK');

const flush = evaluateHand(c('2h', '5h', '9h', 'Jh', 'Kh', '3c', '8d'));
assert(flush.category === 'flush', `7-card flush failed: ${flush.category}`);

console.log('OK ranking');

console.log('— Pot odds —');
assert(Math.abs(potOdds(100, 50) - 1 / 3) < 1e-9, 'pot odds 100/50');
console.log('OK pot odds');

console.log('— Equity sanity —');
const eqAA = estimateEquity(c('Ah', 'Ad'), [], 1, 400, 42);
const eq72 = estimateEquity(c('7h', '2d'), [], 1, 400, 42);
assert(eqAA.equity > 0.75, `AA equity ${eqAA.equity}`);
assert(eq72.equity < 0.4, `72o equity ${eq72.equity}`);
assert(eqAA.equity > eq72.equity, 'AA > 72o');
console.log(`OK equity AA=${(eqAA.equity * 100).toFixed(1)}% 72o=${(eq72.equity * 100).toFixed(1)}%`);

console.log('— Heuristic persona cases —');
let g = createGame({ smallBlind: 50, bigBlind: 100, maxSeats: 2, seed: 1 });
g = sitPlayer(g, 0, { playerId: 'h', name: 'Hero', stack: 10000 });
g = sitPlayer(g, 1, { playerId: 'b', name: 'Rook', stack: 10000, isBot: true, botPersona: 'rook' });
g = startHand(g, 99);

const seat = g.currentSeat!;
const actor = g.seats[seat];
const stack = actor.stack;
actor.holeCards = c('As', 'Ad');
const legal = getLegalActions(g);
const legalize = (persona: string) => {
  const proposed = decideTournamentAction(g, seat, persona, legal);
  return legalizeBotDecision(proposed, legal, stack);
};
const nit = legalize('rook');
assert(nit.type === 'raise' || nit.type === 'bet' || nit.type === 'all-in' || nit.type === 'call', `nit with AA should not fold: ${nit.type} ${nit.reason}`);
console.log(`OK Rook with AA → ${nit.type} (${nit.reason})`);

actor.holeCards = c('7h', '2c');
const nitTrash = legalize('rook');
assert(nitTrash.type !== 'all-in' || nitTrash.confidence < 0.5, 'nit should not happily shove 72o');
console.log(`OK Rook with 72o → ${nitTrash.type} (${nitTrash.reason})`);

const harbor = legalize('harbor');
console.log(`OK Harbor with 72o → ${harbor.type} (${harbor.reason})`);

g.street = 'river';
g.community = c('9h', '9d', '9c', '2s', '3d');
actor.holeCards = c('9s', 'Ah');
actor.bet = 0;
g.currentBet = 500;
actor.hasActed = false;
g.pot = 2000;
const g2 = JSON.parse(JSON.stringify(g));
g2.seats[seat].bet = 0;
g2.seats[seat].stack = 5000;
g2.currentBet = 500;
const legal2 = getLegalActions(g2);
if (legal2.some((a) => a.type === 'fold')) {
  const d = legalizeBotDecision(decideTournamentAction(g2, seat, 'mira', legal2), legal2, g2.seats[seat].stack);
  assert(d.type !== 'fold', `must not fold quads: ${d.type} ${d.reason}`);
  console.log(`OK Mira with quads facing bet → ${d.type}`);
} else {
  console.log('skip nuts fold test (no fold legal)');
}

console.log('— Shipped ML policy-v1 —');
let mlGame = createGame({ smallBlind: 50, bigBlind: 100, maxSeats: 2, seed: 1 });
mlGame = sitPlayer(mlGame, 0, { playerId: 'h', name: 'Hero', stack: 10000 });
mlGame = sitPlayer(mlGame, 1, { playerId: 'b', name: 'Rook', stack: 10000, isBot: true, botPersona: 'rook' });
mlGame = startHand(mlGame, 99);
const mlSeat = mlGame.currentSeat!;
mlGame.seats[mlSeat]!.holeCards = c('As', 'Ad');
const mlLegal = getLegalActions(mlGame);
const mlAa = decideAction(mlGame, mlSeat, 'rook', mlLegal);
assert(mlLegal.some((a) => a.type === mlAa.type), `ML action not legal: ${mlAa.type}`);
assert(mlAa.type !== 'fold', `ML with AA should not fold: ${mlAa.type} ${mlAa.reason}`);
console.log(`OK ML AA → ${mlAa.type} (${mlAa.reason})`);
mlGame.seats[mlSeat]!.holeCards = c('7h', '2c');
const mlTrash = decideAction(mlGame, mlSeat, 'rook', mlLegal);
assert(mlLegal.some((a) => a.type === mlTrash.type), `ML 72o not legal: ${mlTrash.type}`);
console.log(`OK ML 72o → ${mlTrash.type} (${mlTrash.reason})`);

console.log('\nAll bot tests passed.');
