export function formatChips(n: number): string {
  if (!Number.isFinite(n)) return '0';
  return Math.floor(n).toLocaleString('en-US');
}
