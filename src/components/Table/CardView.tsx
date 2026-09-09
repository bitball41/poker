import { motion, useReducedMotion } from 'framer-motion';
import type { Card } from '../../types/poker';
import { RANK_LABELS, SUIT_SYMBOLS } from '../../engine/cards';
import styles from './table.module.css';

interface Props {
  card?: Card | null;
  faceDown?: boolean;
  large?: boolean;
  mini?: boolean;
  delay?: number;
  /** Empty community slot — dashed felt outline, not a fake card back */
  slot?: boolean;
}

export function CardView({ card, faceDown, large, mini, delay = 0, slot }: Props) {
  const reduceMotion = useReducedMotion();
  const empty = Boolean(slot && !card);
  const back = Boolean(!empty && (faceDown || !card));
  const faceUp = Boolean(card && !back && !empty);
  const red = Boolean(card && faceUp && (card.suit === 'h' || card.suit === 'd'));

  return (
    <motion.div
      className={[
        styles.card,
        large ? styles.cardLarge : '',
        mini ? styles.cardMini : '',
        back ? styles.cardBack : '',
        empty ? styles.cardSlot : '',
        red ? styles.cardRed : faceUp ? styles.cardBlack : '',
      ]
        .filter(Boolean)
        .join(' ')}
      aria-hidden={empty}
      initial={reduceMotion
        ? { opacity: 0 }
        : faceUp
          ? { opacity: 0.35, y: -8, scale: 0.96 }
          : { opacity: 0, y: -8, scale: 0.96 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={reduceMotion
        ? { delay, duration: 0.12 }
        : { delay, type: 'spring', stiffness: 280, damping: 24 }}
    >
      {faceUp && card ? (
        <>
          <span className={styles.cardCorner}>
            <span className={styles.cardRank}>{RANK_LABELS[card.rank]}</span>
            <span className={styles.cardSuit}>{SUIT_SYMBOLS[card.suit]}</span>
          </span>
          {large && <span className={styles.cardPip}>{SUIT_SYMBOLS[card.suit]}</span>}
        </>
      ) : back && !mini ? (
        <span className={styles.cardBackMark}>♠</span>
      ) : null}
    </motion.div>
  );
}
