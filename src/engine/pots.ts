import type { SeatState, SidePot } from '../types/poker';

/** Compute main + side pots from contributions of non-folded / all-in players */
export function computeSidePots(seats: SeatState[]): SidePot[] {
  const contributors = seats
    .filter((s) => s.totalBet > 0 && !s.sittingOut)
    .map((s) => ({ seat: s.seatIndex, total: s.totalBet, folded: s.folded }));

  if (contributors.length === 0) return [];

  const levels = [...new Set(contributors.map((c) => c.total))].sort((a, b) => a - b);
  const pots: SidePot[] = [];
  let prev = 0;

  for (const level of levels) {
    const layer = level - prev;
    if (layer <= 0) continue;
    const involved = contributors.filter((c) => c.total >= level);
    const amount = layer * involved.length;
    const eligible = involved.filter((c) => !c.folded).map((c) => c.seat);
    if (amount > 0) {
      pots.push({ amount, eligibleSeats: eligible.length ? eligible : involved.map((c) => c.seat) });
    }
    prev = level;
  }

  // Merge pots with identical eligibility
  const merged: SidePot[] = [];
  for (const p of pots) {
    const key = p.eligibleSeats.slice().sort().join(',');
    const existing = merged.find((m) => m.eligibleSeats.slice().sort().join(',') === key);
    if (existing) existing.amount += p.amount;
    else merged.push({ ...p, eligibleSeats: [...p.eligibleSeats] });
  }
  return merged;
}

export function totalPot(seats: SeatState[]): number {
  return seats.reduce((sum, s) => sum + s.totalBet, 0);
}
