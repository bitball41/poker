import { Link, useSearchParams } from 'react-router-dom';
import { motion } from 'framer-motion';
import { useBotGame } from '../hooks/useBotGame';
import { PokerTable } from '../components/Table/PokerTable';
import styles from './pages.module.css';

function finiteInt(raw: string | null, fallback: number, min: number, max: number): number {
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(n)));
}

export function Play() {
  const [params] = useSearchParams();
  const seats = finiteInt(params.get('seats'), 6, 2, 9);
  const buyIn = finiteInt(params.get('buyIn'), 10000, 100, 1_000_000);
  const smallBlind = finiteInt(params.get('sb'), 0, 0, buyIn);
  const bigBlind = finiteInt(params.get('bb'), 0, 0, buyIn);
  const { state, coachLine, actingBot, heroSeat, heroAct, nextHand, restart } = useBotGame({
    seats,
    buyIn,
    smallBlind,
    bigBlind,
  });

  return (
    <motion.div
      className={`${styles.page} ${styles.playPage}`}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
    >
      <nav className={styles.playNav}>
        <Link to="/" className={styles.backChevron} aria-label="Back">
          ‹
        </Link>
        <button
          type="button"
          className={styles.restartTiny}
          onClick={() => {
            if (window.confirm('Restart this game? Current stacks and hand history will be lost.')) restart();
          }}
        >
          Restart
        </button>
      </nav>

      {!state ? (
        <div className={styles.empty}>Dealing…</div>
      ) : (
        <>
          <PokerTable
            state={state}
            heroSeat={heroSeat}
            coachLine={coachLine}
            actingBot={actingBot}
            onAct={heroAct}
          />
          {state.street === 'complete' && state.seats[heroSeat]?.stack > 0 && state.seats.filter((s) => !s.sittingOut && s.stack > 0).length >= 2 && (
            <div style={{ display: 'flex', justifyContent: 'center', marginTop: '0.75rem' }}>
              <button type="button" className={styles.primary} onClick={nextHand}>
                Next hand
              </button>
            </div>
          )}
        </>
      )}
    </motion.div>
  );
}
