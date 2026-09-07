import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import type { LegalAction } from '../../types/poker';
import styles from './table.module.css';

interface Props {
  legal: LegalAction[];
  pot: number;
  bb: number;
  disabled?: boolean;
  onAct: (type: string, amount?: number) => void;
}

export function ActionBar({ legal, pot, bb, disabled, onAct }: Props) {
  const raise = legal.find((a) => a.type === 'raise' || a.type === 'bet');
  const call = legal.find((a) => a.type === 'call');
  const canFold = legal.some((a) => a.type === 'fold');
  const canCheck = legal.some((a) => a.type === 'check');
  const canAllIn = legal.some((a) => a.type === 'all-in');

  const min = raise?.min ?? bb;
  const max = raise?.max ?? min;
  const [raiseAmt, setRaiseAmt] = useState(min);

  useEffect(() => {
    setRaiseAmt(Math.min(max, Math.max(min, Math.round(pot * 0.5) || min)));
  }, [min, max, pot]);

  if (!legal.length) return null;

  return (
    <motion.div
      className={styles.actionBar}
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
    >
      {canFold && (
        <button className={`${styles.actBtn} ${styles.fold}`} disabled={disabled} onClick={() => onAct('fold')} title="Give up this hand">
          Fold
        </button>
      )}
      {canCheck && (
        <button className={`${styles.actBtn} ${styles.check}`} disabled={disabled} onClick={() => onAct('check')} title="Pass action when nothing to call">
          Check
        </button>
      )}
      {call && (
        <button className={`${styles.actBtn} ${styles.call}`} disabled={disabled} onClick={() => onAct('call')} title="Match the current bet">
          Call {call.callAmount}
        </button>
      )}
      {raise && (
        <div className={styles.raiseGroup}>
          <input
            type="range"
            min={min}
            max={max}
            value={Math.min(max, Math.max(min, raiseAmt))}
            onChange={(e) => setRaiseAmt(Number(e.target.value))}
            disabled={disabled}
          />
          <div className={styles.raisePresets}>
            <button type="button" disabled={disabled} onClick={() => setRaiseAmt(Math.min(max, Math.max(min, Math.round(pot / 3))))}>1/3</button>
            <button type="button" disabled={disabled} onClick={() => setRaiseAmt(Math.min(max, Math.max(min, Math.round(pot / 2))))}>1/2</button>
            <button type="button" disabled={disabled} onClick={() => setRaiseAmt(Math.min(max, Math.max(min, Math.round(pot * 0.66))))}>2/3</button>
            <button type="button" disabled={disabled} onClick={() => setRaiseAmt(Math.min(max, Math.max(min, pot || min)))}>Pot</button>
          </div>
          <button
            className={`${styles.actBtn} ${styles.raise}`}
            disabled={disabled}
            onClick={() => onAct(raise.type, raiseAmt)}
            title="Increase the bet"
          >
            {raise.type === 'bet' ? 'Bet' : 'Raise'} {raiseAmt}
          </button>
        </div>
      )}
      {canAllIn && (
        <button className={`${styles.actBtn} ${styles.allin}`} disabled={disabled} onClick={() => onAct('all-in')} title="Put all practice chips in">
          All-in
        </button>
      )}
    </motion.div>
  );
}
