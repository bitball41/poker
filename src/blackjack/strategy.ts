import type { Card } from '../types/poker';
import { handTotal } from './engine';

/** Dealer upcard value 2–11 (A=11) */
function upValue(card: Card): number {
  if (card.rank === 14) return 11;
  if (card.rank >= 10) return 10;
  return card.rank;
}

export type BasicAction = 'hit' | 'stand' | 'double';

/**
 * Simplified basic strategy (no splits). S17, 4-deck-ish.
 * Returns recommended action + short coach line.
 */
export function basicStrategy(
  player: Card[],
  dealerUp: Card,
  canDouble: boolean,
): { action: BasicAction; reason: string } {
  const { total, soft } = handTotal(player);
  const up = upValue(dealerUp);

  if (total >= 21) return { action: 'stand', reason: 'Hard 21 — stand.' };

  // Soft totals
  if (soft) {
    if (total >= 19) return { action: 'stand', reason: `Soft ${total} — stand.` };
    if (total === 18) {
      if (up >= 9) return { action: 'hit', reason: 'Soft 18 vs 9+ — hit.' };
      if (canDouble && up >= 3 && up <= 6) {
        return { action: 'double', reason: 'Soft 18 vs 3–6 — double if allowed.' };
      }
      return { action: 'stand', reason: 'Soft 18 — stand.' };
    }
    // soft 13–17
    if (canDouble && up >= 4 && up <= 6) {
      return { action: 'double', reason: `Soft ${total} vs ${up} — double.` };
    }
    return { action: 'hit', reason: `Soft ${total} — hit.` };
  }

  // Hard totals
  if (total >= 17) return { action: 'stand', reason: `Hard ${total} — stand.` };
  if (total >= 13 && total <= 16) {
    if (up >= 2 && up <= 6) return { action: 'stand', reason: `Hard ${total} vs weak ${up} — stand.` };
    return { action: 'hit', reason: `Hard ${total} vs ${up} — hit.` };
  }
  if (total === 12) {
    if (up >= 4 && up <= 6) return { action: 'stand', reason: 'Hard 12 vs 4–6 — stand.' };
    return { action: 'hit', reason: 'Hard 12 — hit.' };
  }
  if (total === 11) {
    if (canDouble) return { action: 'double', reason: 'Hard 11 — double.' };
    return { action: 'hit', reason: 'Hard 11 — hit (no double).' };
  }
  if (total === 10) {
    if (canDouble && up <= 9) return { action: 'double', reason: 'Hard 10 vs 2–9 — double.' };
    return { action: 'hit', reason: 'Hard 10 — hit.' };
  }
  if (total === 9) {
    if (canDouble && up >= 3 && up <= 6) return { action: 'double', reason: 'Hard 9 vs 3–6 — double.' };
    return { action: 'hit', reason: 'Hard 9 — hit.' };
  }
  return { action: 'hit', reason: `Hard ${total} — hit.` };
}
