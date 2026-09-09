/** Place opponents on an arc around an oval table, leaving the bottom for the hero. */
export function opponentSeatStyle(index: number, count: number): { left: string; top: string } {
  const t = count <= 1 ? 0.5 : index / (count - 1);
  const deg = -120 + t * 240;
  const rad = (deg * Math.PI) / 180;
  const x = 50 + Math.sin(rad) * 42;
  const y = 46 - Math.cos(rad) * 36;
  return { left: `${x}%`, top: `${y}%` };
}
