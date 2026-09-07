import { motion, AnimatePresence } from 'framer-motion';
import type { GameState, ActionType, Card, PlayerAction } from '../../types/poker';
import { CardView } from './CardView';
import { ActionBar } from './ActionBar';
import { getLegalActions } from '../../engine/game';
import { evaluateHand, CATEGORY_NAMES } from '../../bots/handStrength';
import styles from './table.module.css';

const EMOJI_POOL = [
  '😺', '👽', '🐰', '🧑', '🦊', '🐼', '🐸', '🐵',
  '🦁', '🐯', '🦄', '🐲', '🦉', '🐨', '🐶', '🐻',
  '🐷', '🐮', '🐹', '🐤',
];

function emojiForName(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) {
    h = (h * 31 + name.charCodeAt(i)) >>> 0;
  }
  return EMOJI_POOL[h % EMOJI_POOL.length];
}

function heroHandLabel(hole: Card[] | null, community: Card[]): string {
  if (!hole || hole.length < 2) return '';
  const all = [...hole, ...community];
  if (all.length >= 5) {
    try {
      return evaluateHand(all).name;
    } catch {
      return CATEGORY_NAMES['high-card'];
    }
  }
  if (hole[0].rank === hole[1].rank) return CATEGORY_NAMES.pair;
  return CATEGORY_NAMES['high-card'];
}

/** Most recent street action label for bet/raise/call pills */
function lastAggressiveLabel(history: PlayerAction[], seatIndex: number): string | null {
  for (let i = history.length - 1; i >= 0; i--) {
    const a = history[i];
    if (a.seat !== seatIndex) continue;
    if (a.type === 'bet') return 'Bet';
    if (a.type === 'raise') return 'Raise';
    if (a.type === 'call') return 'Call';
    if (a.type === 'all-in') return 'All-in';
    if (a.type === 'check') return 'Check';
    if (a.type === 'fold') return 'Fold';
    return null;
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
  const opponents = state.seats.filter(
    (s) => s.seatIndex !== heroSeat && s.playerId && !s.sittingOut,
  );
  const handLabel = heroHandLabel(hero?.holeCards ?? null, state.community);
  const heroEmoji = emojiForName(hero?.name || 'You');
  const showdown = state.street === 'complete' || state.street === 'showdown';

  return (
    <div className={styles.tableWrap}>
      {/* Opponents — horizontal emoji row */}
      <div className={styles.oppRow}>
        {opponents.map((seat) => {
          const isTurn = state.currentSeat === seat.seatIndex;
          const isDealer = seat.seatIndex === state.button;
          const dimmed = !isTurn || seat.folded;
          const rawLabel =
            seat.bet > 0
              ? lastAggressiveLabel(state.history, seat.seatIndex) || 'Bet'
              : lastAggressiveLabel(state.history, seat.seatIndex);
          const showActionPill =
            !!rawLabel &&
            (rawLabel === 'Bet' ||
              rawLabel === 'Raise' ||
              rawLabel === 'Call' ||
              rawLabel === 'All-in');
          const actionLabel = showActionPill ? rawLabel : null;

          return (
            <div
              key={seat.seatIndex}
              className={[
                styles.oppSeat,
                dimmed ? styles.oppDimmed : styles.oppActive,
                seat.folded ? styles.oppFolded : '',
              ]
                .filter(Boolean)
                .join(' ')}
            >
              <div className={styles.oppActionSlot}>
                {showActionPill && <span className={styles.actionPill}>{actionLabel}</span>}
              </div>
              <div className={styles.oppAvatarWrap}>
                <span className={styles.oppEmoji} aria-hidden>
                  {emojiForName(seat.name || '?')}
                </span>
                {isDealer && <span className={styles.dealerBadge}>D</span>}
              </div>
              <div className={styles.oppName}>{seat.name}</div>
              <div className={styles.oppStack}>{seat.stack}</div>
              <div className={styles.oppBetSlot}>
                {seat.bet > 0 && <span className={styles.betPill}>{seat.bet}</span>}
              </div>
              {showdown && seat.holeCards && !seat.folded && (
                <div className={styles.oppShowdown}>
                  <CardView card={seat.holeCards[0]} delay={0} />
                  <CardView card={seat.holeCards[1]} delay={0.04} />
                </div>
              )}
            </div>
          );
        })}
      </div>

      {actingBot && <div className={styles.actingHint}>{actingBot}</div>}

      {/* Community board + pot */}
      <div className={styles.stage}>
        <div className={styles.boardRow}>
          <div className={styles.board}>
            {[0, 1, 2, 3, 4].map((i) => (
              <CardView
                key={i}
                card={state.community[i] ?? null}
                slot
                delay={state.community[i] ? i * 0.06 : 0}
              />
            ))}
          </div>
          <AnimatePresence>
            {state.pot > 0 && (
              <motion.div
                key="pot"
                className={styles.pot}
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
              >
                {state.pot}
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {state.winners && state.winners.length > 0 && (
          <div className={styles.winnerBanner}>
            {state.winners.map((w, i) => (
              <span key={i}>
                {state.seats[w.seat]?.name} wins {w.amount}
                {w.handName ? ` · ${w.handName}` : ''}
                {i < state.winners!.length - 1 ? ' · ' : ''}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Actions */}
      <div className={styles.hud}>
        {isHeroTurn && (
          <ActionBar
            legal={legal}
            pot={state.pot}
            bb={state.config.bigBlind}
            onAct={(t, a) => onAct(t as ActionType, a)}
          />
        )}
      </div>

      {/* Hero — hole cards left, status tile right */}
      {hero && hero.playerId && (
        <div className={`${styles.heroZone} ${hero.folded ? styles.heroFolded : ''}`}>
          <div className={styles.heroCards}>
            {hero.holeCards && !hero.folded ? (
              <>
                <CardView card={hero.holeCards[0]} large delay={0} />
                <CardView card={hero.holeCards[1]} large delay={0.05} />
              </>
            ) : hero.folded ? (
              <div className={styles.foldedTag}>Folded</div>
            ) : showdown && hero.holeCards ? (
              <>
                <CardView card={hero.holeCards[0]} large delay={0} />
                <CardView card={hero.holeCards[1]} large delay={0.05} />
              </>
            ) : null}
          </div>

          <div className={styles.heroTile}>
            <div className={styles.heroHandLabel}>{handLabel || '—'}</div>
            <div className={styles.heroEmoji}>{heroEmoji}</div>
            <motion.div
              className={styles.heroStackBig}
              key={hero.stack}
              initial={{ opacity: 0.6 }}
              animate={{ opacity: 1 }}
            >
              {hero.stack}
            </motion.div>
            {hero.bet > 0 && <span className={styles.betPill}>{hero.bet}</span>}
            {hero.seatIndex === state.button && (
              <span className={styles.heroDealer}>D</span>
            )}
          </div>
        </div>
      )}

      {coachLine && <div className={styles.coachTiny}>{coachLine}</div>}
    </div>
  );
}
