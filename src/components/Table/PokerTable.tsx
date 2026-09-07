import { motion } from 'framer-motion';
import type { GameState, ActionType, Card } from '../../types/poker';
import { CardView } from './CardView';
import { ActionBar } from './ActionBar';
import { HandLog } from './HandLog';
import { getLegalActions } from '../../engine/game';
import { evaluateHand, CATEGORY_NAMES } from '../../bots/handStrength';
import styles from './table.module.css';
import fix from './tableFixes.module.css';

const EMOJI_POOL = [
  '😺', '👽', '🐰', '🧑', '🦊', '🐼', '🐸', '🐵',
  '🦁', '🐯', '🦄', '🐲', '🦉', '🐨', '🐶', '🐻',
  '🐷', '🐮', '🐹', '🐤',
];

function emojiForName(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return EMOJI_POOL[h % EMOJI_POOL.length];
}

function heroHandLabel(hole: Card[] | null, community: Card[]): string {
  if (!hole || hole.length < 2) return '';
  const all = [...hole, ...community];
  if (all.length >= 5) {
    try { return evaluateHand(all).name; } catch { return CATEGORY_NAMES['high-card']; }
  }
  if (hole[0].rank === hole[1].rank) return CATEGORY_NAMES.pair;
  return CATEGORY_NAMES['high-card'];
}

function actionCopy(
  last: { type: ActionType; amount?: number } | null,
  opts: { sb: number; bb: number; isSb: boolean; isBb: boolean },
): { label: string; kind: 'passive' | 'aggressive' | 'fold' | 'blind' } | null {
  if (!last) return null;
  const amt = last.amount ?? 0;
  if (last.type === 'fold') return { label: 'Fold', kind: 'fold' };
  if (last.type === 'check') return { label: 'Check', kind: 'passive' };
  if (last.type === 'call') return { label: amt ? `Call ${amt}` : 'Call', kind: 'passive' };
  if (last.type === 'all-in') return { label: amt ? `All-in ${amt}` : 'All-in', kind: 'aggressive' };
  if (last.type === 'raise') return { label: amt ? `Raise ${amt}` : 'Raise', kind: 'aggressive' };
  if (last.type === 'bet') {
    if (opts.isSb && amt === opts.sb && amt > 0) return { label: 'Small blind', kind: 'blind' };
    if (opts.isBb && amt === opts.bb && amt > 0) return { label: 'Big blind', kind: 'blind' };
    if (amt <= 0) return null;
    return { label: `Bet ${amt}`, kind: 'aggressive' };
  }
  return null;
}

interface Props {
  state: GameState;
  heroSeat: number;
  coachLine?: string | null;
  actingBot?: string | null;
  onAct: (type: ActionType, amount?: number) => void;
}

export function PokerTable({ state, heroSeat, coachLine, actingBot, onAct }: Props) {
  const legal = state.currentSeat === heroSeat ? getLegalActions(state) : [];
  const hero = state.seats[heroSeat];
  const isHeroTurn = state.currentSeat === heroSeat && state.street !== 'complete';
  const opponents = state.seats.filter((s) => s.seatIndex !== heroSeat && s.playerId && !s.sittingOut);
  const handLabel = heroHandLabel(hero?.holeCards ?? null, state.community);
  const heroEmoji = emojiForName(hero?.name || 'You');
  const showdown = state.street === 'complete' || state.street === 'showdown';
  const sbAmt = state.config.smallBlind;
  const bbAmt = state.config.bigBlind;
  const heroIn = hero?.totalBet ?? 0;
  const heroLeft = hero?.stack ?? 0;

  return (
    <div className={styles.playShell}>
      <div className={styles.tableWrap}>
        <div className={styles.moneyStrip} aria-label="Chips">
          <div className={styles.moneyCell}><span className={styles.moneyLabel}>Pot</span><span className={styles.moneyValue}>{state.pot}</span></div>
          <div className={styles.moneyCell}><span className={styles.moneyLabel}>Your bet</span><span className={styles.moneyValue}>{heroIn}</span></div>
          <div className={styles.moneyCell}><span className={styles.moneyLabel}>You have</span><span className={`${styles.moneyValue} ${styles.moneyStrong}`}>{heroLeft}</span></div>
        </div>

        <div className={styles.oppRow}>
          {opponents.map((seat) => {
            const isTurn = state.currentSeat === seat.seatIndex;
            const isDealer = seat.seatIndex === state.button;
            const move = actionCopy(seat.lastAction, {
              sb: sbAmt, bb: bbAmt,
              isSb: seat.seatIndex === state.sbSeat,
              isBb: seat.seatIndex === state.bbSeat,
            });
            return (
              <div key={seat.seatIndex} className={[styles.oppSeat, seat.folded ? styles.oppFolded : '', isTurn ? styles.oppTurn : ''].filter(Boolean).join(' ')}>
                <div className={styles.oppActionSlot}>
                  {move && <span className={[styles.actionPill, move.kind === 'fold' ? styles.actionFold : '', move.kind === 'passive' ? styles.actionPassive : '', move.kind === 'blind' ? styles.actionBlind : '', move.kind === 'aggressive' ? styles.actionAgg : ''].filter(Boolean).join(' ')}>{move.label}</span>}
                </div>
                <div className={styles.oppAvatarWrap}>
                  <span className={styles.oppEmoji} aria-hidden>{emojiForName(seat.name || '?')}</span>
                  {isDealer && <span className={styles.dealerBadge}>D</span>}
                </div>
                <div className={styles.oppName}>{seat.name}</div>
                <div className={styles.oppStack}>{seat.stack}</div>
                {showdown && seat.holeCards && !seat.folded && <div className={styles.oppShowdown}><CardView card={seat.holeCards[0]} delay={0} /><CardView card={seat.holeCards[1]} delay={0.04} /></div>}
              </div>
            );
          })}
        </div>

        {actingBot && <div className={styles.actingHint}>{actingBot}</div>}

        <div className={styles.stage}>
          <div className={styles.boardRow}>
            <div className={styles.board}>
              {[0, 1, 2, 3, 4].map((i) => <CardView key={i} card={state.community[i] ?? null} slot delay={state.community[i] ? i * 0.06 : 0} />)}
            </div>
          </div>
          {state.winners && state.winners.length > 0 && <div className={styles.winnerBanner}>{state.winners.map((w, i) => <span key={i}>{state.seats[w.seat]?.name} wins {w.amount}{w.handName ? ` · ${w.handName}` : ''}{i < state.winners!.length - 1 ? ' · ' : ''}</span>)}</div>}
        </div>

        <div className={styles.hud}>
          {isHeroTurn && <ActionBar legal={legal} pot={state.pot} bb={state.config.bigBlind} onAct={(t, a) => onAct(t as ActionType, a)} />}
        </div>

        {hero && hero.playerId && (
          <div className={`${styles.heroZone} ${fix.heroZone} ${hero.folded ? styles.heroFolded : ''}`}>
            <div className={`${styles.heroCards} ${fix.heroCards}`}>
              {hero.holeCards && !hero.folded ? <><CardView card={hero.holeCards[0]} large delay={0} /><CardView card={hero.holeCards[1]} large delay={0.05} /></> : hero.folded ? <div className={styles.foldedTag}>Folded</div> : showdown && hero.holeCards ? <><CardView card={hero.holeCards[0]} large delay={0} /><CardView card={hero.holeCards[1]} large delay={0.05} /></> : null}
            </div>

            <div className={`${styles.heroTile} ${fix.heroTile}`}>
              {(() => {
                const move = actionCopy(hero.lastAction, {
                  sb: sbAmt, bb: bbAmt,
                  isSb: hero.seatIndex === state.sbSeat,
                  isBb: hero.seatIndex === state.bbSeat,
                });
                return move ? <span className={[styles.actionPill, styles.heroActionPill, move.kind === 'fold' ? styles.actionFold : '', move.kind === 'passive' ? styles.actionPassive : '', move.kind === 'blind' ? styles.actionBlind : '', move.kind === 'aggressive' ? styles.actionAgg : ''].filter(Boolean).join(' ')}>{move.label}</span> : null;
              })()}
              <div className={styles.heroHandLabel}>{handLabel || '—'}</div>
              <div className={styles.heroEmoji}>{heroEmoji}</div>
              <div className={fix.heroName}>{hero.name || 'You'}</div>
              <motion.div className={styles.heroStackBig} key={hero.stack} initial={{ opacity: 0.6 }} animate={{ opacity: 1 }}>{hero.stack}</motion.div>
              {hero.seatIndex === state.button && <span className={styles.heroDealer}>D</span>}
            </div>
          </div>
        )}

        {coachLine && <div className={styles.coachTiny}>{coachLine}</div>}
      </div>
      <HandLog state={state} />
    </div>
  );
}
