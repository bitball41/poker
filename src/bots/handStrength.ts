import type { Card, Rank } from '../types/poker';

export type HandCategory =
  | 'high-card'
  | 'pair'
  | 'two-pair'
  | 'trips'
  | 'straight'
  | 'flush'
  | 'full-house'
  | 'quads'
  | 'straight-flush'
  | 'royal-flush';

export const CATEGORY_RANK: Record<HandCategory, number> = {
  'high-card': 0,
  pair: 1,
  'two-pair': 2,
  trips: 3,
  straight: 4,
  flush: 5,
  'full-house': 6,
  quads: 7,
  'straight-flush': 8,
  'royal-flush': 9,
};

export const CATEGORY_NAMES: Record<HandCategory, string> = {
  'high-card': 'High Card',
  pair: 'Pair',
  'two-pair': 'Two Pair',
  trips: 'Three of a Kind',
  straight: 'Straight',
  flush: 'Flush',
  'full-house': 'Full House',
  quads: 'Four of a Kind',
  'straight-flush': 'Straight Flush',
  'royal-flush': 'Royal Flush',
};

export interface HandValue {
  category: HandCategory;
  rank: number;
  kickers: number[];
  score: number;
  name: string;
}

function scoreFrom(category: HandCategory, kickers: number[]): number {
  let s = CATEGORY_RANK[category];
  for (let i = 0; i < 5; i++) s = s * 15 + (kickers[i] ?? 0);
  return s;
}

function uniqueSortedRanks(cards: Card[]): Rank[] {
  return [...new Set(cards.map((c) => c.rank))].sort((a, b) => b - a) as Rank[];
}

function findStraightHigh(ranks: number[]): number | null {
  const uniq = [...new Set(ranks)].sort((a, b) => b - a);

  // Search high-to-low first. The wheel is a fallback, not a priority.
  // Otherwise A-2-3-4-5 plus 6 (or higher connected cards) incorrectly
  // reports a five-high straight even though a higher straight exists.
  for (const start of uniq) {
    if (start < 6) continue;
    let ok = true;
    for (let d = 1; d < 5; d++) {
      if (!uniq.includes(start - d)) {
        ok = false;
        break;
      }
    }
    if (ok) return start;
  }

  if (uniq.includes(14) && uniq.includes(5) && uniq.includes(4) && uniq.includes(3) && uniq.includes(2)) {
    return 5;
  }
  return null;
}

export function evaluateHand(cards: Card[]): HandValue {
  if (cards.length < 5) throw new Error(`Need at least 5 cards, got ${cards.length}`);
  if (cards.length === 5) return evaluateFive(cards);
  let best: HandValue | null = null;
  const idxs = combinations(cards.length, 5);
  for (const combo of idxs) {
    const five = combo.map((i) => cards[i]);
    const v = evaluateFive(five);
    if (!best || v.score > best.score) best = v;
  }
  return best!;
}

function combinations(n: number, k: number): number[][] {
  const out: number[][] = [];
  const cur: number[] = [];
  function rec(start: number) {
    if (cur.length === k) {
      out.push([...cur]);
      return;
    }
    for (let i = start; i < n; i++) {
      cur.push(i);
      rec(i + 1);
      cur.pop();
    }
  }
  rec(0);
  return out;
}

function evaluateFive(cards: Card[]): HandValue {
  const byRank = new Map<number, number>();
  const bySuit = new Map<string, Card[]>();
  for (const c of cards) {
    byRank.set(c.rank, (byRank.get(c.rank) ?? 0) + 1);
    const arr = bySuit.get(c.suit) ?? [];
    arr.push(c);
    bySuit.set(c.suit, arr);
  }

  const counts = [...byRank.entries()].sort((a, b) => {
    if (b[1] !== a[1]) return b[1] - a[1];
    return b[0] - a[0];
  });

  const ranks = cards.map((c) => c.rank);
  const isFlush = [...bySuit.values()].some((arr) => arr.length >= 5);
  let flushCards: Card[] | null = null;
  if (isFlush) flushCards = [...bySuit.values()].find((arr) => arr.length >= 5)!;

  const straightHigh = findStraightHigh(ranks);
  let flushStraightHigh: number | null = null;
  if (flushCards) flushStraightHigh = findStraightHigh(flushCards.map((c) => c.rank));

  if (flushStraightHigh !== null) {
    const category: HandCategory = flushStraightHigh === 14 ? 'royal-flush' : 'straight-flush';
    const kickers = [flushStraightHigh, 0, 0, 0, 0];
    return {
      category,
      rank: CATEGORY_RANK[category],
      kickers,
      score: scoreFrom(category, kickers),
      name: CATEGORY_NAMES[category],
    };
  }

  if (counts[0][1] === 4) {
    const quad = counts[0][0];
    const kicker = counts.find((c) => c[0] !== quad)![0];
    const kickers = [quad, kicker, 0, 0, 0];
    return { category: 'quads', rank: 7, kickers, score: scoreFrom('quads', kickers), name: CATEGORY_NAMES.quads };
  }

  if (counts[0][1] === 3 && counts[1][1] >= 2) {
    const trip = counts[0][0];
    const pair = counts[1][0];
    const kickers = [trip, pair, 0, 0, 0];
    return {
      category: 'full-house',
      rank: 6,
      kickers,
      score: scoreFrom('full-house', kickers),
      name: CATEGORY_NAMES['full-house'],
    };
  }

  if (flushCards) {
    const fr = uniqueSortedRanks(flushCards).slice(0, 5);
    const kickers = [...fr, 0, 0, 0, 0].slice(0, 5);
    return { category: 'flush', rank: 5, kickers, score: scoreFrom('flush', kickers), name: CATEGORY_NAMES.flush };
  }

  if (straightHigh !== null) {
    const kickers = [straightHigh, 0, 0, 0, 0];
    return { category: 'straight', rank: 4, kickers, score: scoreFrom('straight', kickers), name: CATEGORY_NAMES.straight };
  }

  if (counts[0][1] === 3) {
    const trip = counts[0][0];
    const kickers = [trip, ...counts.filter((c) => c[0] !== trip).map((c) => c[0]).slice(0, 2), 0, 0].slice(0, 5);
    while (kickers.length < 5) kickers.push(0 as Rank);
    return { category: 'trips', rank: 3, kickers, score: scoreFrom('trips', kickers), name: CATEGORY_NAMES.trips };
  }

  if (counts[0][1] === 2 && counts[1][1] === 2) {
    const hi = Math.max(counts[0][0], counts[1][0]);
    const lo = Math.min(counts[0][0], counts[1][0]);
    const kicker = counts.find((c) => c[0] !== hi && c[0] !== lo)![0];
    const kickers = [hi, lo, kicker, 0, 0];
    return {
      category: 'two-pair',
      rank: 2,
      kickers,
      score: scoreFrom('two-pair', kickers),
      name: CATEGORY_NAMES['two-pair'],
    };
  }

  if (counts[0][1] === 2) {
    const pair = counts[0][0];
    const kickers = [pair, ...counts.filter((c) => c[0] !== pair).map((c) => c[0]).slice(0, 3), 0].slice(0, 5);
    while (kickers.length < 5) kickers.push(0 as Rank);
    return { category: 'pair', rank: 1, kickers, score: scoreFrom('pair', kickers), name: CATEGORY_NAMES.pair };
  }

  const kickers = uniqueSortedRanks(cards).slice(0, 5);
  while (kickers.length < 5) kickers.push(0 as Rank);
  return {
    category: 'high-card',
    rank: 0,
    kickers,
    score: scoreFrom('high-card', kickers),
    name: CATEGORY_NAMES['high-card'],
  };
}

export function compareHands(a: HandValue, b: HandValue): number {
  return a.score - b.score;
}

export function handStrengthNormalized(value: HandValue): number {
  const maxScore = scoreFrom('royal-flush', [14, 0, 0, 0, 0]);
  return Math.min(1, value.score / maxScore);
}

export interface DrawInfo {
  flushDraw: boolean;
  oesd: boolean;
  gutshot: boolean;
  outs: number;
}

export function detectDraws(hole: Card[], board: Card[]): DrawInfo {
  const all = [...hole, ...board];
  if (board.length >= 5) return { flushDraw: false, oesd: false, gutshot: false, outs: 0 };
  const bySuit = new Map<string, number>();
  for (const c of all) bySuit.set(c.suit, (bySuit.get(c.suit) ?? 0) + 1);
  const flushDraw = [...bySuit.values()].some((n) => n === 4);

  const ranks = [...new Set(all.map((c) => c.rank))].sort((a, b) => a - b);
  let oesd = false;
  let gutshot = false;
  const withAceLow = ranks.includes(14) ? [1, ...ranks.filter((r) => r !== 14)] : ranks;

  for (let high = 5; high <= 14; high++) {
    const needed = [high, high - 1, high - 2, high - 3, high - 4].map((r) => (r === 1 ? 14 : r));
    const missing = needed.filter((r) => !all.some((c) => c.rank === r));
    if (missing.length === 1) {
      const miss = missing[0] === 14 ? 1 : missing[0];
      const ends = miss === high || miss === high - 4 || (high === 5 && miss === 14);
      if (ends || (high === 5 && missing[0] === 14)) oesd = true;
      else gutshot = true;
    }
  }

  for (let i = 0; i < withAceLow.length; i++) {
    const window = [withAceLow[i]];
    for (let j = i + 1; j < withAceLow.length && window.length < 4; j++) {
      if (withAceLow[j] === window[window.length - 1] + 1) window.push(withAceLow[j]);
      else break;
    }
    if (window.length === 4 && !(window[0] === 1 && window[3] === 4)) oesd = true;
  }

  let outs = 0;
  if (flushDraw) outs += 9;
  if (oesd) outs += 8;
  else if (gutshot) outs += 4;
  if (flushDraw && (oesd || gutshot)) outs -= 2;

  return { flushDraw, oesd, gutshot, outs: Math.max(0, outs) };
}
