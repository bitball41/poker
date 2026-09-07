export type PositionLabel = 'BTN' | 'SB' | 'BB' | 'UTG' | 'MP' | 'CO';

/**
 * Map seat index to position label given button seat and occupied seats.
 * Seats after button (clockwise): SB, BB, UTG, ... CO, BTN
 */
export function getPosition(
  seatIndex: number,
  button: number,
  activeSeats: number[],
): PositionLabel {
  const ordered = [...activeSeats].sort((a, b) => {
    const da = (a - button + 100) % 100;
    const db = (b - button + 100) % 100;
    return da - db;
  });
  // ordered[0] is button
  const n = ordered.length;
  const idx = ordered.indexOf(seatIndex);
  if (idx < 0) return 'MP';
  if (idx === 0) return 'BTN';
  if (n === 2) return idx === 1 ? 'BB' : 'BTN'; // HU: button is SB
  if (idx === 1) return 'SB';
  if (idx === 2) return 'BB';
  if (idx === n - 1) return 'CO';
  // Early = UTG, middle = MP
  const earlyEnd = Math.floor((n - 3) / 2) + 3; // after BB
  if (idx <= earlyEnd) return 'UTG';
  return 'MP';
}

export function positionTightness(pos: PositionLabel): number {
  // Higher = tighter open requirement (0–1 scale additive to range)
  switch (pos) {
    case 'UTG': return 0.85;
    case 'MP': return 0.7;
    case 'CO': return 0.45;
    case 'BTN': return 0.25;
    case 'SB': return 0.55;
    case 'BB': return 0.4;
  }
}

export function isInPosition(hero: PositionLabel, vs: PositionLabel): boolean {
  // Postflop IP: later position acts last — BTN best, then CO, etc. SB/BB OOP vs late
  const ipRank: Record<PositionLabel, number> = {
    BTN: 5, CO: 4, MP: 3, UTG: 2, SB: 1, BB: 0,
  };
  return ipRank[hero] > ipRank[vs];
}
