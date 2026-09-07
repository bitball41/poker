import { motion } from 'framer-motion';
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
  const empty = slot && !card;
  const back = faceDown || empty || !card;
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
      initial={{ opacity: 0, y: -10, scale: 0.94 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ delay, type: 'spring', stiffness: 280, damping: 24 }}
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
