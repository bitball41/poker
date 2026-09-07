import { motion, useReducedMotion } from 'framer-motion';
import type { Card } from '../../types/poker';
import { RANK_LABELS, SUIT_SYMBOLS } from '../../engine/cards';
import styles from './table.module.css';

interface Props {
  card?: Card | null;
  faceDown?: boolean;
  large?: boolean;
  delay?: number;
  /** Empty community slot — white face with diagonal stripes */
  slot?: boolean;
}

export function CardView({ card, faceDown, large, delay = 0, slot }: Props) {
  const reduceMotion = useReducedMotion();
  const empty = slot && !card;
  const back = faceDown || empty || !card;
  const faceUp = Boolean(card && !back);
  const red = card && !back && (card.suit === 'h' || card.suit === 'd');

  return (
    <motion.div
      className={[
        styles.card,
        large ? styles.cardLarge : '',
        back ? styles.cardBack : '',
        empty ? styles.cardSlot : '',
        red ? styles.cardRed : !back ? styles.cardBlack : '',
      ]
        .filter(Boolean)
        .join(' ')}
      style={{
        transformPerspective: 900,
        transformStyle: 'preserve-3d',
        backfaceVisibility: 'hidden',
      }}
      initial={reduceMotion
        ? { opacity: 0 }
        : faceUp
          ? { opacity: 0.35, y: -8, scale: 0.96, rotateY: 88 }
          : { opacity: 0, y: -8, scale: 0.96, rotateY: 0 }}
      animate={{ opacity: 1, y: 0, scale: 1, rotateY: 0 }}
      transition={reduceMotion
        ? { delay, duration: 0.12 }
        : faceUp
          ? { delay, rotateY: { duration: 0.34, ease: [0.22, 1, 0.36, 1] }, opacity: { duration: 0.18 }, y: { duration: 0.28 } }
          : { delay, type: 'spring', stiffness: 280, damping: 24 }}
    >
      {card && !back ? (
        <>
          <span className={styles.cardRank}>{RANK_LABELS[card.rank]}</span>
          <span className={styles.cardSuit}>{SUIT_SYMBOLS[card.suit]}</span>
        </>
      ) : null}
    </motion.div>
  );
}
