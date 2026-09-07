import { motion } from 'framer-motion';
import styles from './table.module.css';

export function EquityMeter({ equity, label }: { equity: number | null; label?: string }) {
  if (equity == null) return null;
  const pct = Math.round(equity * 100);
  return (
    <div className={styles.equityMeter} title="Estimated win chance vs remaining opponents (Monte Carlo)">
      <div className={styles.equityLabel}>{label ?? 'Win chance'} {pct}%</div>
      <div className={styles.equityTrack}>
        <motion.div
          className={styles.equityFill}
          animate={{ width: `${pct}%` }}
          transition={{ type: 'spring', stiffness: 120, damping: 20 }}
        />
      </div>
    </div>
  );
}
