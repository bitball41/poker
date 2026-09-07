import type { Card } from '../types/poker';
import { formatHand, RANK_LABELS } from '../engine/cards';
import type { PositionLabel } from './position';

export type HandCombo = string; // "AKs", "AKo", "22"

/** Generate all 169 starting hands */
export function allCombos(): HandCombo[] {
  const ranks = [14, 13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2] as const;
  const out: HandCombo[] = [];
  for (let i = 0; i < ranks.length; i++) {
    for (let j = i; j < ranks.length; j++) {
      const a = RANK_LABELS[ranks[i]];
      const b = RANK_LABELS[ranks[j]];
      if (i === j) out.push(`${a}${b}`);
      else {
        out.push(`${a}${b}s`);
        out.push(`${a}${b}o`);
      }
    }
  }
  return out;
}

export function holeToCombo(cards: Card[]): HandCombo {
  return formatHand(cards) as HandCombo;
}

/** Strength score for ranking combos roughly (higher = stronger) */
export function comboStrength(combo: HandCombo): number {
  const pairs: Record<string, number> = {
    AA: 100, KK: 98, QQ: 95, JJ: 90, TT: 85, '99': 78, '88': 72, '77': 65,
    '66': 58, '55': 52, '44': 45, '33': 38, '22': 32,
  };
  if (pairs[combo] != null) return pairs[combo];

  const suited = combo.endsWith('s');
  const off = combo.endsWith('o');
  const core = suited || off ? combo.slice(0, -1) : combo;
  const r1 = rankVal(core[0]);
  const r2 = rankVal(core[1]);
  const hi = Math.max(r1, r2);
  const lo = Math.min(r1, r2);
  const gap = hi - lo;
  let s = hi * 4 + lo;
  if (suited) s += 8;
  if (gap === 1) s += 6; // connector
  else if (gap === 2) s += 3;
  if (hi === 14) s += 10; // ace
  if (hi === 13) s += 4;
  if (off && gap > 3 && lo < 10) s -= 8;
  return s;
}

function rankVal(ch: string): number {
  const m: Record<string, number> = {
    A: 14, K: 13, Q: 12, J: 11, T: 10,
    '9': 9, '8': 8, '7': 7, '6': 6, '5': 5, '4': 4, '3': 3, '2': 2,
  };
  return m[ch] ?? 0;
}

/** Build a range set by taking top percentile of combos */
export function rangeByPercent(pct: number): Set<HandCombo> {
  const all = allCombos().sort((a, b) => comboStrength(b) - comboStrength(a));
  const n = Math.max(1, Math.round((pct / 100) * all.length));
  return new Set(all.slice(0, n));
}

export type ActionKind = 'open' | 'call' | '3bet';

/** Base open % by position (approximate) */
const BASE_OPEN: Record<PositionLabel, number> = {
  UTG: 12, MP: 16, CO: 25, BTN: 40, SB: 32, BB: 0,
};

const BASE_CALL: Record<PositionLabel, number> = {
  UTG: 8, MP: 10, CO: 14, BTN: 18, SB: 20, BB: 28,
};

const BASE_3BET: Record<PositionLabel, number> = {
  UTG: 4, MP: 5, CO: 7, BTN: 9, SB: 8, BB: 8,
};

export function getRange(
  position: PositionLabel,
  action: ActionKind,
  vpipTarget: number,
  pfrTarget: number,
): Set<HandCombo> {
  // Scale base ranges by persona VPIP/PFR (typical TAG ~22/18)
  const vpipScale = vpipTarget / 22;
  const pfrScale = pfrTarget / 18;

  let pct: number;
  if (action === 'open') {
    pct = BASE_OPEN[position] * pfrScale;
  } else if (action === '3bet') {
    pct = BASE_3BET[position] * pfrScale * 1.1;
  } else {
    pct = BASE_CALL[position] * vpipScale;
  }
  pct = Math.max(2, Math.min(85, pct));
  return rangeByPercent(pct);
}

export function inRange(combo: HandCombo, range: Set<HandCombo>): boolean {
  return range.has(combo);
}
