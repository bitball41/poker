import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import type { LegalAction } from '../../types/poker';
import { formatChips } from '../../lib/format';
import styles from './table.module.css';
import economy from './tableEconomy.module.css';

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
  const allIn = legal.find((a) => a.type === 'all-in');
  const canFold = legal.some((a) => a.type === 'fold');
  const canCheck = legal.some((a) => a.type === 'check');
  const canAllIn = Boolean(allIn);
  const allInIsForcedCall = canAllIn && allIn?.callAmount != null && !raise;
  const hasSizingPanel = Boolean(raise || (canAllIn && !allInIsForcedCall));

  const min = raise?.min ?? Math.max(1, bb || 1);
  const max = raise?.max ?? min;
  const [raiseAmt, setRaiseAmt] = useState(min);
  const [panelOpen, setPanelOpen] = useState(false);

  useEffect(() => {
    const half = Math.round(pot * 0.5) || min;
    setRaiseAmt(Math.min(max, Math.max(min, half)));
    setPanelOpen(false);
  }, [min, max, pot]);

  if (!legal.length) return null;

  const clamp = (n: number) => Math.min(max, Math.max(min, n));
  const betLabel = raise?.type === 'bet' ? 'Bet' : 'Raise';

  const submitSizedAction = () => {
    if (!raise) return;
    onAct(raise.type, clamp(raiseAmt));
    setPanelOpen(false);
  };

  return (
    <motion.div
      className={styles.actionBar}
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
    >
      <div className={styles.actionRow}>
        {canFold && (
          <button type="button" className={`${styles.actBtn} ${styles.actFold}`} disabled={disabled} onClick={() => onAct('fold')}>
            Fold
          </button>
        )}
        {canCheck && (
          <button type="button" className={`${styles.actBtn} ${styles.actCall}`} disabled={disabled} onClick={() => onAct('check')}>
            Check
          </button>
        )}
        {call && (
          <button type="button" className={`${styles.actBtn} ${styles.actCall}`} disabled={disabled} onClick={() => onAct('call')}>
            Call {formatChips(call.callAmount ?? 0)}
          </button>
        )}
        {allInIsForcedCall && allIn && (
          <button type="button" className={`${styles.actBtn} ${styles.actFold}`} disabled={disabled} onClick={() => onAct('all-in')}>
            Call {formatChips(allIn.callAmount ?? 0)} · All-in
          </button>
        )}
        {raise && (
          <button
            type="button"
            className={`${styles.actBtn} ${styles.actRaise}`}
            disabled={disabled}
            aria-expanded={panelOpen}
            onClick={() => setPanelOpen((v) => !v)}
          >
            {betLabel}
          </button>
        )}
        {!raise && hasSizingPanel && (
          <button
            type="button"
            className={`${styles.actBtn} ${styles.actRaise}`}
            disabled={disabled}
            aria-expanded={panelOpen}
            onClick={() => setPanelOpen((v) => !v)}
          >
            More
          </button>
        )}
      </div>

      <AnimatePresence>
        {panelOpen && hasSizingPanel && (
          <motion.div
            className={styles.raisePanel}
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
          >
            {raise && (
              <div className={styles.sliderRow}>
                <span className={styles.sliderHint}>{formatChips(raiseAmt)}</span>
                <input
                  className={styles.raiseSlider}
                  type="range"
                  min={min}
                  max={max}
                  value={clamp(raiseAmt)}
                  onChange={(e) => setRaiseAmt(Number(e.target.value))}
                  disabled={disabled}
                  aria-label={`${betLabel} amount`}
                />
              </div>
            )}
            <div className={styles.raisePresets}>
              {raise && (
                <>
                  <button type="button" className={styles.presetBtn} disabled={disabled} onClick={() => setRaiseAmt(clamp(min))}>
                    Min
                  </button>
                  <button type="button" className={styles.presetBtn} disabled={disabled} onClick={() => setRaiseAmt(clamp(Math.round(pot / 2) || min))}>
                    1/2 Pot
                  </button>
                  <button type="button" className={styles.presetBtn} disabled={disabled} onClick={() => setRaiseAmt(clamp(pot || min))}>
                    Pot
                  </button>
                  <button type="button" className={`${styles.presetBtn} ${styles.actRaise}`} disabled={disabled} onClick={submitSizedAction}>
                    {betLabel} {formatChips(clamp(raiseAmt))}
                  </button>
                </>
              )}
              {canAllIn && !allInIsForcedCall && (
                <button type="button" className={`${styles.presetBtn} ${economy.allInPreset}`} disabled={disabled} onClick={() => onAct('all-in')}>
                  All-in
                </button>
              )}
              <button type="button" className={styles.iconBtn} disabled={disabled} aria-label="Close bet sizing" onClick={() => setPanelOpen(false)}>
                ✕
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
