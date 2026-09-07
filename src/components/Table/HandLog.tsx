import type { GameState, PlayerAction, Street } from '../../types/poker';
import styles from './table.module.css';

const STREET_LABEL: Partial<Record<Street, string>> = {
  preflop: 'Preflop',
  flop: 'Flop',
  turn: 'Turn',
  river: 'River',
};

function lineFor(
  a: PlayerAction,
  name: string,
  blinds: { sb: number; bb: number; sbSeat: number; bbSeat: number },
): string | null {
  const amt = a.amount ?? 0;
  switch (a.type) {
    case 'fold':
      return `${name} folded`;
    case 'check':
      return `${name} checked`;
    case 'call':
      return `${name} called ${amt}`;
    case 'bet':
      if (a.street === 'preflop' && a.seat === blinds.sbSeat && amt === blinds.sb) {
        if (amt <= 0) return null;
        return `${name} posted small blind ${amt}`;
      }
      if (a.street === 'preflop' && a.seat === blinds.bbSeat && amt === blinds.bb) {
        if (amt <= 0) return null;
        return `${name} posted big blind ${amt}`;
      }
      return `${name} bet ${amt}`;
    case 'raise':
      return `${name} raised to ${amt}`;
    case 'all-in':
      return `${name} went all-in${amt ? ` (${amt})` : ''}`;
    default:
      return `${name} acted`;
  }
}

export function HandLog({ state }: { state: GameState }) {
  const blinds = {
    sb: state.config.smallBlind,
    bb: state.config.bigBlind,
    sbSeat: state.sbSeat,
    bbSeat: state.bbSeat,
  };

  type Row =
    | { kind: 'street'; key: string; label: string }
    | { kind: 'act'; key: string; text: string };

  type StreetGroup = { street: Street; firstIndex: number; rows: Row[] };
  const groups: StreetGroup[] = [];
  let current: StreetGroup | null = null;

  state.history.forEach((a, i) => {
    const name = state.seats[a.seat]?.name ?? `Seat ${a.seat + 1}`;
    const text = lineFor(a, name, blinds);
    if (!text) return;

    const street = (a.street ?? 'preflop') as Street;
    if (!current || current.street !== street) {
      current = {
        street,
        firstIndex: i,
        rows: [
          {
            kind: 'street',
            key: `st-${street}-${i}`,
            label: STREET_LABEL[street] ?? street,
          },
        ],
      };
      groups.push(current);
    }

    current.rows.push({ kind: 'act', key: `a-${i}`, text });
  });

  // Newest street first, but NEVER reverse actions inside a street.
  // Reversing the flat row array made valid poker action look like time travel.
  const display = [...groups]
    .sort((a, b) => b.firstIndex - a.firstIndex)
    .flatMap((g) => g.rows);

  return (
    <aside className={styles.handLog} aria-label="Hand log">
      <div className={styles.handLogTitle}>Hand log</div>
      <div className={styles.handLogList}>
        {display.length === 0 ? (
          <div className={styles.handLogEmpty}>Waiting for action…</div>
        ) : (
          display.map((r) =>
            r.kind === 'street' ? (
              <div key={r.key} className={styles.handLogStreet}>
                {r.label}
              </div>
            ) : (
              <div key={r.key} className={styles.handLogLine}>
                {r.text}
              </div>
            ),
          )
        )}
      </div>
    </aside>
  );
}
