import { motion, AnimatePresence } from 'framer-motion';
import type { GameState } from '../../types/poker';
import { CardView } from './CardView';
import { ActionBar } from './ActionBar';
import { EquityMeter } from './EquityMeter';
import { getLegalActions } from '../../engine/game';
import type { ActionType } from '../../types/poker';
import styles from './table.module.css';

interface Props {
  state: GameState;
  heroSeat: number;
  coachLine?: string | null;
  equity?: number | null;
  actingBot?: string | null;
  onAct: (type: ActionType, amount?: number) => void;
}

/** Seat positions around oval — percentages */
function seatPos(i: number, n: number, heroSeat: number): { left: string; top: string } {
  // Rotate so hero is at bottom
  const rel = ((i - heroSeat) % n + n) % n;
  // Map to angles: 0 = bottom
  const angle = (rel / n) * Math.PI * 2 + Math.PI / 2;
  const x = 50 + 42 * Math.cos(angle);
  const y = 50 + 38 * Math.sin(angle);
  return { left: `${x}%`, top: `${y}%` };
}

export function PokerTable({ state, heroSeat, coachLine, equity, actingBot, onAct }: Props) {
  const n = state.seats.length;
  const legal = state.currentSeat === heroSeat ? getLegalActions(state) : [];
  const hero = state.seats[heroSeat];
  const isHeroTurn = state.currentSeat === heroSeat && state.street !== 'complete';

  return (
    <div className={styles.tableWrap}>
      <div className={styles.felt}>
        <div className={styles.feltInner}>
          <div className={styles.potArea}>
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

          {state.seats.map((seat) => {
            if (seat.sittingOut && !seat.playerId) return null;
            const pos = seatPos(seat.seatIndex, n, heroSeat);
            const isHero = seat.seatIndex === heroSeat;
            const isTurn = state.currentSeat === seat.seatIndex;
            return (
              <div
                key={seat.seatIndex}
                className={`${styles.seat} ${isHero ? styles.seatHero : ''} ${isTurn ? styles.seatTurn : ''} ${seat.folded ? styles.seatFolded : ''}`}
                style={pos}
              >
                <div className={styles.seatAvatar} style={{ borderColor: seat.isBot ? '#555' : '#aaa' }}>
                  {(seat.name || '?')[0]}
                </div>
                <div className={styles.seatInfo}>
                  <div className={styles.seatName}>
                    {seat.name}
                    {seat.seatIndex === state.button && <span className={styles.btn}>D</span>}
                    {seat.isBot && seat.botPersona && (
                      <span className={styles.persona}>{seat.botPersona}</span>
                    )}
                  </div>
                  <motion.div
                    className={styles.seatStack}
                    key={seat.stack}
                    initial={{ y: -4, opacity: 0.5 }}
                    animate={{ y: 0, opacity: 1 }}
                  >
                    {seat.stack}
                    {seat.bet > 0 && <span className={styles.seatBet}> · bet {seat.bet}</span>}
                  </motion.div>
                </div>
                <div className={styles.seatCards}>
                  {seat.holeCards && (isHero || state.street === 'complete' || seat.folded === false && state.winners) ? (
                    seat.folded && !isHero ? null : (
                      <>
                        <CardView
                          card={seat.holeCards[0]}
                          faceDown={!isHero && state.street !== 'complete'}
                          large={isHero}
                          delay={0}
                        />
                        <CardView
                          card={seat.holeCards[1]}
                          faceDown={!isHero && state.street !== 'complete'}
                          large={isHero}
                          delay={0.06}
                        />
                      </>
                    )
                  ) : seat.holeCards && !seat.folded ? (
                    <>
                      <CardView faceDown large={isHero} />
                      <CardView faceDown large={isHero} delay={0.05} />
                    </>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className={styles.hud}>
        {equity != null && <EquityMeter equity={equity} />}
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
  );
}
