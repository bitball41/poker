import { motion } from 'framer-motion';
import type { GameState, ActionType, Card } from '../../types/poker';
import type { BlindPressure } from '../../economy/blinds';
import { CardView } from './CardView';
import { ActionBar } from './ActionBar';
import { HandLog } from './HandLog';
import { getLegalActions } from '../../engine/game';
import { evaluateHand, CATEGORY_NAMES } from '../../bots/handStrength';
import { formatChips } from '../../lib/format';
import { opponentSeatStyle } from '../../lib/seatLayout';
import styles from './table.module.css';
import economy from './tableEconomy.module.css';

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

function cardKey(prefix: string, card: Card | null | undefined): string {
  return `${prefix}-${card ? `${card.rank}${card.suit}` : 'slot'}`;
}

function actionCopy(
  last: { type: ActionType; amount?: number } | null,
  opts: { sb: number; bb: number; isSb: boolean; isBb: boolean },
): { label: string; kind: 'passive' | 'aggressive' | 'fold' | 'blind' } | null {
  if (!last) return null;
  const amt = last.amount ?? 0;
  if (last.type === 'fold') return { label: 'Fold', kind: 'fold' };
  if (last.type === 'check') return { label: 'Check', kind: 'passive' };
  if (last.type === 'call') return { label: amt ? `Call ${formatChips(amt)}` : 'Call', kind: 'passive' };
  if (last.type === 'all-in') return { label: amt ? `All-in ${formatChips(amt)}` : 'All-in', kind: 'aggressive' };
  if (last.type === 'raise') return { label: amt ? `Raise ${formatChips(amt)}` : 'Raise', kind: 'aggressive' };
  if (last.type === 'bet') {
    if (opts.isSb && amt === opts.sb && amt > 0) return { label: 'Small blind', kind: 'blind' };
    if (opts.isBb && amt === opts.bb && amt > 0) return { label: 'Big blind', kind: 'blind' };
    if (amt <= 0) return null;
    return { label: `Bet ${formatChips(amt)}`, kind: 'aggressive' };
  }
  return null;
}

interface Props {
  state: GameState;
  heroSeat: number;
  coachLine?: string | null;
  actingBot?: string | null;
  heroAvatarUrl?: string | null;
  rankLabel?: string;
  pressure?: BlindPressure;
  onAct: (type: ActionType, amount?: number) => void;
}

export function PokerTable({
  state,
  heroSeat,
  coachLine,
  actingBot,
  heroAvatarUrl,
  rankLabel,
  pressure,
  onAct,
}: Props) {
  const legal = state.currentSeat === heroSeat ? getLegalActions(state) : [];
  const hero = state.seats[heroSeat];
  const isHeroTurn = state.currentSeat === heroSeat && state.street !== 'complete';
  const opponents = state.seats.filter((s) => s.seatIndex !== heroSeat && s.playerId && !s.sittingOut);
  const handLabel = heroHandLabel(hero?.holeCards ?? null, state.community);
  const heroEmoji = emojiForName(hero?.name || 'You');
  const showdown = state.street === 'complete' || state.street === 'showdown';
  const sbAmt = state.config.smallBlind;
  const bbAmt = state.config.bigBlind;
  const heroLeft = hero?.stack ?? 0;

  return (
    <div className={styles.playShell}>
      <div className={styles.tableWrap}>
        {(pressure || rankLabel) && (
          <div className={styles.tableMetaRow}>
            {pressure && (
              <span>
                Hand {state.handNo} · blinds {state.config.smallBlind}/{state.config.bigBlind} · target {formatChips(pressure.targetChips)} by hand {pressure.targetHand}
              </span>
            )}
            {rankLabel && <span className={economy.rankMeta}>{rankLabel}</span>}
          </div>
        )}

        <div className={styles.feltStage}>
          <div className={styles.rail}>
            <div className={styles.felt}>
              {opponents.map((seat, i) => {
                const isTurn = state.currentSeat === seat.seatIndex;
                const isDealer = seat.seatIndex === state.button;
                const move = actionCopy(seat.lastAction, {
                  sb: sbAmt, bb: bbAmt,
                  isSb: seat.seatIndex === state.sbSeat,
                  isBb: seat.seatIndex === state.bbSeat,
                });
                const pos = opponentSeatStyle(i, opponents.length);
                const reveal = showdown && seat.holeCards && !seat.folded;
                return (
                  <div
                    key={seat.seatIndex}
                    className={[styles.seat, seat.folded ? styles.seatFolded : '', isTurn ? styles.seatTurn : ''].filter(Boolean).join(' ')}
                    style={pos}
                  >
                    <div className={styles.actionSlot}>
                      {move && (
                        <span className={[styles.actionPill, move.kind === 'fold' ? styles.actionFold : '', move.kind === 'passive' ? styles.actionPassive : '', move.kind === 'blind' ? styles.actionBlind : '', move.kind === 'aggressive' ? styles.actionAgg : ''].filter(Boolean).join(' ')}>
                          {move.label}
                        </span>
                      )}
                    </div>
                    <div className={styles.avatarWrap}>
                      <span className={styles.oppEmoji} aria-hidden>{emojiForName(seat.name || '?')}</span>
                      {isDealer && <span className={styles.dealerBadge}>D</span>}
                    </div>
                    <div className={styles.seatName}>{seat.name}</div>
                    <div className={styles.seatStack}>{formatChips(seat.stack)}</div>
                    {seat.bet > 0 && <div className={styles.betChip}>{formatChips(seat.bet)}</div>}
                    <div className={styles.oppHole}>
                      {reveal ? (
                        <>
                          <CardView mini key={cardKey(`opp-${seat.seatIndex}-0`, seat.holeCards![0])} card={seat.holeCards![0]} delay={0} />
                          <CardView mini key={cardKey(`opp-${seat.seatIndex}-1`, seat.holeCards![1])} card={seat.holeCards![1]} delay={0.08} />
                        </>
                      ) : !seat.folded ? (
                        <>
                          <CardView mini faceDown />
                          <CardView mini faceDown />
                        </>
                      ) : null}
                    </div>
                  </div>
                );
              })}

              <div className={styles.boardCenter}>
                <div className={styles.potBadge}>POT<span>{formatChips(state.pot)}</span></div>
                <div className={styles.board}>
                  {[0, 1, 2, 3, 4].map((i) => {
                    const card = state.community[i] ?? null;
                    return <CardView key={cardKey(`board-${i}`, card)} card={card} slot delay={card ? i * 0.08 : 0} />;
                  })}
                </div>
                {state.winners && state.winners.length > 0 && (
                  <div className={styles.winnerBanner}>
                    {state.winners.map((w, i) => (
                      <span key={i}>
                        {state.seats[w.seat]?.name} wins {formatChips(w.amount)}{w.handName ? ` · ${w.handName}` : ''}{i < state.winners!.length - 1 ? ' · ' : ''}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        {actingBot && <div className={styles.actingHint}>{actingBot} is thinking…</div>}

        <div className={`${styles.heroRail} ${hero?.folded ? styles.heroFolded : ''}`}>
          {hero && hero.playerId && (
            <div className={styles.heroCards}>
              {hero.holeCards ? (
                <>
                  <CardView key={cardKey('hero-0', hero.holeCards[0])} card={hero.holeCards[0]} large delay={0} />
                  <CardView key={cardKey('hero-1', hero.holeCards[1])} card={hero.holeCards[1]} large delay={0.1} />
                </>
              ) : null}
            </div>
          )}

          {hero && hero.playerId && (
            <div className={styles.heroTile}>
              {(() => {
                const move = actionCopy(hero.lastAction, {
                  sb: sbAmt, bb: bbAmt,
                  isSb: hero.seatIndex === state.sbSeat,
                  isBb: hero.seatIndex === state.bbSeat,
                });
                return move ? <span className={[styles.actionPill, styles.heroActionPill, move.kind === 'fold' ? styles.actionFold : '', move.kind === 'passive' ? styles.actionPassive : '', move.kind === 'blind' ? styles.actionBlind : '', move.kind === 'aggressive' ? styles.actionAgg : ''].filter(Boolean).join(' ')}>{move.label}</span> : null;
              })()}
              <div className={styles.heroHandLabel}>{hero.folded ? 'Folded' : (handLabel || '—')}</div>
              {heroAvatarUrl ? (
                <img className={economy.heroPfp} src={heroAvatarUrl} alt="" />
              ) : (
                <div className={styles.heroEmoji}>{heroEmoji}</div>
              )}
              <div className={styles.heroName}>{hero.name || 'You'}</div>
              <motion.div className={styles.heroStackBig} key={hero.stack} initial={{ opacity: 0.6 }} animate={{ opacity: 1 }}>
                {formatChips(heroLeft)}
              </motion.div>
              {hero.seatIndex === state.button && <span className={styles.heroDealer}>D</span>}
            </div>
          )}

          <div className={styles.hud}>
            {isHeroTurn && <ActionBar legal={legal} pot={state.pot} bb={state.config.bigBlind} onAct={(t, a) => onAct(t as ActionType, a)} />}
          </div>
        </div>

        {coachLine && <div className={styles.coachTiny}>{coachLine}</div>}
      </div>
      <HandLog state={state} />
    </div>
  );
}
