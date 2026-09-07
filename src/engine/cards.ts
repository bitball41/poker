import type { Card, Rank, Suit } from '../types/poker';

export const SUITS: Suit[] = ['h', 'd', 'c', 's'];
export const RANKS: Rank[] = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14];

export const RANK_LABELS: Record<Rank, string> = {
  2: '2', 3: '3', 4: '4', 5: '5', 6: '6', 7: '7', 8: '8', 9: '9',
  10: 'T', 11: 'J', 12: 'Q', 13: 'K', 14: 'A',
};

export const SUIT_SYMBOLS: Record<Suit, string> = {
  h: '♥', d: '♦', c: '♣', s: '♠',
};

export function cardId(c: Card): string {
  return `${RANK_LABELS[c.rank]}${c.suit}`;
}

export function parseCard(s: string): Card {
  const rankChar = s[0].toUpperCase();
  const suit = s[1].toLowerCase() as Suit;
  const rankMap: Record<string, Rank> = {
    '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9,
    T: 10, J: 11, Q: 12, K: 13, A: 14,
  };
  return { rank: rankMap[rankChar], suit };
}

export function makeDeck(): Card[] {
  const deck: Card[] = [];
  for (const suit of SUITS) {
    for (const rank of RANKS) {
      deck.push({ rank, suit });
    }
  }
  return deck;
}

export function cardEquals(a: Card, b: Card): boolean {
  return a.rank === b.rank && a.suit === b.suit;
}

export function removeCards(deck: Card[], remove: Card[]): Card[] {
  return deck.filter((c) => !remove.some((r) => cardEquals(c, r)));
}

export function formatHand(cards: Card[]): string {
  if (cards.length !== 2) return cards.map(cardId).join(' ');
  const [a, b] = [...cards].sort((x, y) => y.rank - x.rank);
  const suited = a.suit === b.suit;
  if (a.rank === b.rank) return `${RANK_LABELS[a.rank]}${RANK_LABELS[b.rank]}`;
  return `${RANK_LABELS[a.rank]}${RANK_LABELS[b.rank]}${suited ? 's' : 'o'}`;
}
