import { Link, useSearchParams } from 'react-router-dom';
import { motion } from 'framer-motion';
import { useBotGame } from '../hooks/useBotGame';
import { PokerTable } from '../components/Table/PokerTable';
import styles from './pages.module.css';

export function Play() {
  const [params] = useSearchParams();
  const seats = Math.min(6, Math.max(2, Number(params.get('seats') ?? 6)));
  const buyIn = Number(params.get('buyIn') ?? 10000);
  const smallBlind = Number(params.get('sb') ?? 0);
  const bigBlind = Number(params.get('bb') ?? 0);
  const { state, coachLine, actingBot, heroSeat, heroAct, restart } = useBotGame({
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
        <button type="button" className={styles.restartTiny} onClick={restart}>
          Restart
        </button>
      </nav>

      {!state ? (
        <div className={styles.empty}>Dealing…</div>
      ) : (
        <PokerTable
          state={state}
          heroSeat={heroSeat}
          coachLine={coachLine}
          actingBot={actingBot}
          onAct={heroAct}
        />
      )}
    </motion.div>
  );
}
