import type { GameState, PlayerAction, Street } from '../../types/poker';
import styles from './table.module.css';

const STREET_LABEL: Partial<Record<Street, string>> = {
  preflop: 'Preflop',
  flop: 'Flop',
  turn: 'Turn',
  river: 'River',
};

type RenderAction = {
  action: PlayerAction;
  added: number;
  streetTotal: number;
};

function renderHistory(state: GameState): RenderAction[] {
  const committed = new Map<number, number>();
  let street: Street | null = null;

  return state.history.map((action) => {
    const actionStreet = (action.street ?? 'preflop') as Street;
    if (street !== actionStreet) {
      street = actionStreet;
      committed.clear();
    }

    const before = committed.get(action.seat) ?? 0;
    const raw = Math.max(0, action.amount ?? 0);
    let added = 0;
    let streetTotal = before;

    switch (action.type) {
      case 'call':
        added = raw;
        streetTotal = before + raw;
        committed.set(action.seat, streetTotal);
        break;
      case 'bet':
      case 'raise':
      case 'all-in':
        streetTotal = raw;
        added = Math.max(0, streetTotal - before);
        committed.set(action.seat, streetTotal);
        break;
      default:
        break;
    }

    return { action, added, streetTotal };
  });
}

function lineFor(
  rendered: RenderAction,
  name: string,
  blinds: { sb: number; bb: number; sbSeat: number; bbSeat: number },
): string | null {
  const { action: a, added, streetTotal } = rendered;
  switch (a.type) {
    case 'fold':
      return `${name} folded`;
    case 'check':
      return `${name} checked`;
    case 'call': {
      if (added <= 0) return `${name} checked`;
      if (streetTotal === added) return `${name} called to ${streetTotal}`;
      return `${name} completed to ${streetTotal} (+${added})`;
    }
    case 'bet':
      if (a.street === 'preflop' && a.seat === blinds.sbSeat && streetTotal === blinds.sb) {
        if (streetTotal <= 0) return null;
        return `${name} posted small blind ${streetTotal}`;
      }
      if (a.street === 'preflop' && a.seat === blinds.bbSeat && streetTotal === blinds.bb) {
        if (streetTotal <= 0) return null;
        return `${name} posted big blind ${streetTotal}`;
      }
      return `${name} bet ${streetTotal}`;
    case 'raise':
      return `${name} raised to ${streetTotal}${added > 0 ? ` (+${added})` : ''}`;
    case 'all-in':
      return `${name} went all-in to ${streetTotal}${added > 0 ? ` (+${added})` : ''}`;
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

  type ActionRow = { kind: 'act'; key: string; text: string };
  type StreetGroup = {
    street: Street;
    firstIndex: number;
    label: string;
    actions: ActionRow[];
  };

  const groups: StreetGroup[] = [];
  let current: StreetGroup | null = null;
  const renderedHistory = renderHistory(state);

  renderedHistory.forEach((rendered, i) => {
    const a = rendered.action;
    const name = state.seats[a.seat]?.name ?? `Seat ${a.seat + 1}`;
    const text = lineFor(rendered, name, blinds);
    if (!text) return;

    const street = (a.street ?? 'preflop') as Street;
    if (!current || current.street !== street) {
      current = {
        street,
        firstIndex: i,
        label: STREET_LABEL[street] ?? street,
        actions: [],
      };
      groups.push(current);
    }

    current.actions.push({ kind: 'act', key: `a-${i}`, text });
  });

  // Newest street first. Within each street, newest action first while keeping
  // the street heading at the top of the group.
  const display = [...groups]
    .sort((a, b) => b.firstIndex - a.firstIndex)
    .flatMap((group) => [
      { kind: 'street' as const, key: `st-${group.street}-${group.firstIndex}`, label: group.label },
      ...[...group.actions].reverse(),
    ]);

  return (
    <aside className={styles.handLog} aria-label="Hand log">
      <div className={styles.handLogTitle}>Hand log</div>
      <div className={styles.handLogList}>
        {display.length === 0 ? (
          <div className={styles.handLogEmpty}>Nothing yet</div>
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
