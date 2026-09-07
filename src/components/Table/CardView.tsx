import { motion } from 'framer-motion';
import type { Card } from '../../types/poker';
import { RANK_LABELS, SUIT_SYMBOLS } from '../../engine/cards';
import styles from './table.module.css';

interface Props {
  card?: Card | null;
  faceDown?: boolean;
  large?: boolean;
  delay?: number;
}

export function CardView({ card, faceDown, large, delay = 0 }: Props) {
  const red = card && (card.suit === 'h' || card.suit === 'd');
  return (
    <motion.div
      className={`${styles.card} ${large ? styles.cardLarge : ''} ${faceDown || !card ? styles.cardBack : ''} ${red ? styles.cardRed : styles.cardBlack}`}
      initial={{ opacity: 0, y: -12, rotateY: 90 }}
      animate={{ opacity: 1, y: 0, rotateY: 0 }}
      transition={{ delay, type: 'spring', stiffness: 260, damping: 22 }}
    >
      {card && !faceDown ? (
        <>
          <span className={styles.cardRank}>{RANK_LABELS[card.rank]}</span>
          <span className={styles.cardSuit}>{SUIT_SYMBOLS[card.suit]}</span>
        </>
      ) : (
        <span className={styles.cardPattern}>◈</span>
      )}
    </motion.div>
  );
}
