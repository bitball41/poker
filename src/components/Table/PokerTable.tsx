import { motion, AnimatePresence } from 'framer-motion';
import type { GameState } from '../../types/poker';
import { CardView } from './CardView';
import { ActionBar } from './ActionBar';
import { getLegalActions } from '../../engine/game';
import type { ActionType } from '../../types/poker';
import styles from './table.module.css';

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

  const showHole = (seatIndex: number, folded: boolean) => {
    const isHero = seatIndex === heroSeat;
    if (isHero) return true;
    if (state.street === 'complete') return true;
    if (folded) return false;
    return false;
  };

  return (
    <div className={styles.tableWrap}>
      {/* Opponents — clean horizontal row */}
      <div className={styles.oppRow}>
        {opponents.map((seat) => {
          const isTurn = state.currentSeat === seat.seatIndex;
          return (
            <div
              key={seat.seatIndex}
              className={`${styles.oppPill} ${isTurn ? styles.oppTurn : ''} ${seat.folded ? styles.oppFolded : ''}`}
            >
              <div className={styles.oppAvatar}>{(seat.name || '?')[0]}</div>
              <div className={styles.oppBody}>
                <div className={styles.oppName}>
                  {seat.name}
                  {seat.seatIndex === state.button && (
                    <span className={styles.dealerBadge} title="Dealer">D</span>
                  )}
                </div>
                <div className={styles.oppStack}>
                  {seat.stack}
                  {seat.bet > 0 && <span className={styles.oppBet}> · {seat.bet}</span>}
                </div>
              </div>
              <div className={styles.oppCards}>
                {seat.holeCards && !seat.folded ? (
                  <>
                    <CardView
                      card={seat.holeCards[0]}
                      faceDown={!showHole(seat.seatIndex, seat.folded)}
                      delay={0}
                    />
                    <CardView
                      card={seat.holeCards[1]}
                      faceDown={!showHole(seat.seatIndex, seat.folded)}
                      delay={0.05}
                    />
                  </>
                ) : seat.holeCards && seat.folded ? null : null}
              </div>
            </div>
          );
        })}
      </div>

      {/* Center stage — community + pot */}
      <div className={styles.stage}>
        <AnimatePresence>
          {state.pot > 0 && (
            <motion.div
              key="pot"
              className={styles.pot}
              initial={{ scale: 0.8, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
            >
              Pot <strong>{state.pot}</strong>
              <span className={styles.muted}> practice chips</span>
            </motion.div>
          )}
        </AnimatePresence>
        <div className={styles.board}>
          {state.community.map((c, i) => (
            <CardView key={`${c.rank}${c.suit}${i}`} card={c} delay={i * 0.08} />
          ))}
        </div>
        {state.street !== 'complete' && (
          <div className={styles.streetTag}>{state.street}</div>
        )}
        {state.winners && state.winners.length > 0 && (
          <div className={styles.winnerBanner}>
            {state.winners.map((w, i) => (
              <span key={i}>
                {state.seats[w.seat]?.name} wins {w.amount}
                {w.handName ? ` (${w.handName})` : ''}
                {i < state.winners!.length - 1 ? ' · ' : ''}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Hero zone */}
      <div className={styles.heroZone}>
        {hero && hero.playerId && (
          <div
            className={`${styles.heroSeat} ${isHeroTurn ? styles.heroTurn : ''} ${hero.folded ? styles.heroFolded : ''}`}
          >
            <div className={styles.heroLabel}>
              <span className={styles.heroAvatar}>{(hero.name || 'Y')[0]}</span>
              <div>
                <div className={styles.heroName}>
                  {hero.name}
                  {hero.seatIndex === state.button && (
                    <span className={styles.dealerBadge} title="Dealer">D</span>
                  )}
                </div>
                <motion.div
                  className={styles.heroStack}
                  key={hero.stack}
                  initial={{ y: -4, opacity: 0.5 }}
                  animate={{ y: 0, opacity: 1 }}
                >
                  {hero.stack}
                  {hero.bet > 0 && <span className={styles.oppBet}> · bet {hero.bet}</span>}
                </motion.div>
              </div>
            </div>
            <div className={styles.heroCards}>
              {hero.holeCards && !hero.folded ? (
                <>
                  <CardView card={hero.holeCards[0]} large delay={0} />
                  <CardView card={hero.holeCards[1]} large delay={0.06} />
                </>
              ) : hero.holeCards && hero.folded ? (
                <div className={styles.foldedTag}>Folded</div>
              ) : null}
            </div>
          </div>
        )}

        <div className={styles.hud}>
          {actingBot && <div className={styles.acting}>{actingBot} is thinking…</div>}
          {coachLine && <div className={styles.coach}>{coachLine}</div>}
          {isHeroTurn && (
            <ActionBar
              legal={legal}
              pot={state.pot}
              bb={state.config.bigBlind}
              onAct={(t, a) => onAct(t as ActionType, a)}
            />
          )}
          {hero && (
            <div className={styles.heroMeta}>
              Your stack: <strong>{hero.stack}</strong> practice chips
              {state.handNo > 0 && <> · Hand #{state.handNo}</>}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
