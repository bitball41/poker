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
): string {
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
        return `${name} posted SB ${amt}`;
      }
      if (a.street === 'preflop' && a.seat === blinds.bbSeat && amt === blinds.bb) {
        return `${name} posted BB ${amt}`;
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

  const rows: Row[] = [];
  let lastStreet: string | undefined;
  state.history.forEach((a, i) => {
    const st = a.street ?? 'preflop';
    if (st !== lastStreet) {
      lastStreet = st;
      rows.push({
        kind: 'street',
        key: `st-${st}-${i}`,
        label: STREET_LABEL[st as Street] ?? st,
      });
    }
    const name = state.seats[a.seat]?.name ?? `Seat ${a.seat + 1}`;
    rows.push({ kind: 'act', key: `a-${i}`, text: lineFor(a, name, blinds) });
  });

  // Newest on top
  const display = [...rows].reverse();

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
