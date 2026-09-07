import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
  createBJ, placeBet, hit, stand, doubleDown, nextRound, handTotal, type BJState,
} from '../blackjack';
import { basicStrategy } from '../blackjack/strategy';
import { CardView } from '../components/Table/CardView';
import { getChipBank, setChipBank } from '../lib/guest';
import styles from './pages.module.css';
import bj from './blackjack.module.css';

export function Blackjack() {
  const [state, setState] = useState<BJState>(() => createBJ(getChipBank()));
  const [betInput, setBetInput] = useState(100);
  const [coachOn, setCoachOn] = useState(true);

  const playerTotal = state.player.cards.length
    ? handTotal(state.player.cards)
    : null;
  const dealerTotal =
    state.dealer.length && (state.phase === 'settle' || state.phase === 'dealer')
      ? handTotal(state.dealer)
      : state.dealer[0]
        ? handTotal([state.dealer[0]])
        : null;

  const hint = useMemo(() => {
    if (!coachOn || state.phase !== 'player' || !state.dealer[0]) return null;
    return basicStrategy(
      state.player.cards,
      state.dealer[0],
      state.player.cards.length === 2 && state.bank >= state.player.bet,
    );
  }, [state, coachOn]);

  const syncBank = (s: BJState) => {
    setChipBank(s.bank);
    setState(s);
  };

  return (
    <motion.div className={styles.page} initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
      <nav className={styles.topNav}>
        <Link to="/" className={styles.brand}>
          <span className={styles.liminalSm}>Liminal</span> Poker
        </Link>
        <div className={styles.topActions}>
          <label className={bj.coachToggle}>
            <input type="checkbox" checked={coachOn} onChange={(e) => setCoachOn(e.target.checked)} />
            Strategy coach
          </label>
          <Link to="/" className={styles.ghostLink}>Home</Link>
        </div>
      </nav>

      <header className={bj.header}>
        <h1 className={bj.title}>Blackjack</h1>
        <p className={styles.muted}>Practice chips only · Dealer stands on all 17s · No splits yet</p>
      </header>

      <div className={bj.table}>
        <div className={bj.section}>
          <div className={bj.label}>
            Dealer {dealerTotal ? `· ${dealerTotal.total}${dealerTotal.soft ? ' soft' : ''}` : ''}
          </div>
          <div className={bj.cards}>
            {state.dealer.map((c, i) => (
              <CardView
                key={`d-${i}-${c.rank}${c.suit}`}
                card={c}
                faceDown={i === 1 && state.phase === 'player'}
                delay={i * 0.06}
              />
            ))}
          </div>
        </div>

        <div className={bj.message}>{state.message}</div>

        <div className={bj.section}>
          <div className={bj.label}>
            You {playerTotal ? `· ${playerTotal.total}${playerTotal.soft ? ' soft' : ''}` : ''}
            {state.player.bet > 0 ? ` · bet ${state.player.bet}` : ''}
          </div>
          <div className={bj.cards}>
            {state.player.cards.map((c, i) => (
              <CardView key={`p-${i}-${c.rank}${c.suit}`} card={c} large delay={i * 0.06} />
            ))}
          </div>
        </div>
      </div>

      {hint && (
        <div className={bj.hint} title="Basic strategy suggestion">
          Coach: <strong>{hint.action}</strong> — {hint.reason}
        </div>
      )}

      <div className={bj.bank}>
        Bank: <strong>{state.bank}</strong> practice chips
      </div>

      <div className={bj.actions}>
        {state.phase === 'betting' && (
          <>
            <input
              type="number"
              min={10}
              max={state.bank}
              step={10}
              value={betInput}
              onChange={(e) => setBetInput(Number(e.target.value))}
              className={bj.betInput}
            />
            <button
              className={styles.primary}
              disabled={state.bank < 10}
              onClick={() => syncBank(placeBet(state, betInput))}
            >
              Deal
            </button>
            {[50, 100, 250, 500].map((n) => (
              <button key={n} type="button" className={styles.ghost} onClick={() => setBetInput(n)}>
                {n}
              </button>
            ))}
          </>
        )}
        {state.phase === 'player' && (
          <>
            <button className={styles.primary} onClick={() => syncBank(hit(state))}>Hit</button>
            <button className={styles.secondary} onClick={() => syncBank(stand(state))}>Stand</button>
            <button
              className={styles.secondary}
              disabled={state.player.cards.length !== 2 || state.bank < state.player.bet}
              onClick={() => syncBank(doubleDown(state))}
              title="Double your bet and take exactly one card"
            >
              Double
            </button>
          </>
        )}
        {state.phase === 'settle' && (
          <button className={styles.primary} onClick={() => setState(nextRound(state))}>
            Next hand
          </button>
        )}
      </div>
    </motion.div>
  );
}
