import { Link, useSearchParams } from 'react-router-dom';
import { motion } from 'framer-motion';
import { useBotGame } from '../hooks/useBotGame';
import { PokerTable } from '../components/Table/PokerTable';
import styles from './pages.module.css';

export function Play() {
  const [params] = useSearchParams();
  const seats = Math.min(6, Math.max(2, Number(params.get('seats') ?? 6)));
  const buyIn = Number(params.get('buyIn') ?? 10000);
  const { state, coachLine, equity, actingBot, heroSeat, heroAct, restart } = useBotGame({
    seats,
    buyIn,
    smallBlind: Math.max(25, Math.round(buyIn / 200)),
    bigBlind: Math.max(50, Math.round(buyIn / 100)),
  });

  return (
    <motion.div
      className={styles.page}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
    >
      <nav className={styles.topNav}>
        <Link to="/" className={styles.brand}>
          <span className={styles.liminalSm}>Liminal</span> Poker
        </Link>
        <div className={styles.topActions}>
          <button type="button" className={styles.ghost} onClick={restart}>Restart</button>
          <Link to="/" className={styles.ghostLink}>Home</Link>
        </div>
      </nav>

      {!state ? (
        <div className={styles.empty}>Dealing…</div>
      ) : (
        <PokerTable
          state={state}
          heroSeat={heroSeat}
          coachLine={coachLine}
          equity={equity}
          actingBot={actingBot}
          onAct={heroAct}
        />
      )}
    </motion.div>
  );
}
