/** Pot odds: price to call vs pot size. Returns required equity to break even. */
export function potOdds(pot: number, toCall: number): number {
  if (toCall <= 0) return 0;
  return toCall / (pot + toCall);
}

/** Rough implied odds multiplier based on SPR remaining */
export function impliedOddsFactor(stackBehind: number, toCall: number, pot: number): number {
  if (toCall <= 0) return 1;
  const spr = stackBehind / Math.max(1, pot + toCall);
  if (spr > 4) return 1.25;
  if (spr > 2) return 1.12;
  if (spr > 1) return 1.05;
  return 1;
}

/** Minimum Defense Frequency vs a bet of size `bet` into pot `pot` */
export function mdf(pot: number, bet: number): number {
  if (bet <= 0) return 1;
  return pot / (pot + bet);
}

export function shouldCallByOdds(
  equity: number,
  pot: number,
  toCall: number,
  stackBehind: number,
  thresholdPad = 0,
): boolean {
  const required = potOdds(pot, toCall) / impliedOddsFactor(stackBehind, toCall, pot);
  return equity + thresholdPad >= required;
}

/** Stack-to-pot ratio */
export function spr(effectiveStack: number, pot: number): number {
  if (pot <= 0) return Infinity;
  return effectiveStack / pot;
}
