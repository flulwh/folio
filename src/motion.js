/**
 * Motion system — macOS-flavoured.
 *
 * Principles
 *  - Motion explains hierarchy, never decorates: content fades + settles,
 *    surfaces (panels, sheets, dialogs) move with near-critical springs.
 *  - Fast in, faster out: entering 220–340ms, leaving ~65% of that.
 *  - Distances are small (8–14px), scale is tiny (0.99–1.02); the eye should
 *    read "settling", not "flying".
 *  - Springs are ~critically damped (damping ratio .88–1.0): a trace of
 *    overshoot on small surfaces, none on large ones.
 *  - Reduced motion still communicates: opacity only, everything else 0.
 */

/* Apple's "ease" for large surface moves (sheets, page changes). */
export const EASE = [0.32, 0.72, 0, 1];
/* Standard control easing for hover / press / small UI. */
export const EASE_SOFT = [0.4, 0, 0.2, 1];
/* Slight overshoot for playful micro-interactions. */
export const EASE_SPRING = [0.34, 1.56, 0.64, 1];

export const DUR = {
  instant: 0.12,
  fast: 0.18,
  base: 0.24,
  slow: 0.32,
  page: 0.36,
};

/* k / m / c → ratio c / (2·√(k·m)) */
export const SPRING = {
  /* 320 / 0.92 → ratio ≈ .99 : panels glide to rest, no wobble */
  panel: { type: 'spring', stiffness: 320, damping: 34, mass: 0.92 },
  /* 260 / 0.9 → ratio ≈ .91 : cards and rows */
  card: { type: 'spring', stiffness: 280, damping: 25, mass: 0.9 },
  /* 380 / 0.85 → ratio ≈ .95 : dialogs */
  modal: { type: 'spring', stiffness: 400, damping: 28, mass: 0.85 },
  /* 420 / 0.8 → ratio ≈ .82 : toast, a hint of life */
  toast: { type: 'spring', stiffness: 460, damping: 26, mass: 0.8 },
};

const leave = (duration) => ({ duration, ease: EASE });

/* Whole-view swaps: crossfade with the faintest scale settle. */
export const pageVariants = {
  initial: { opacity: 0, scale: 0.992 },
  animate: { opacity: 1, scale: 1, transition: { duration: DUR.page, ease: EASE } },
  exit: { opacity: 0, scale: 0.996, transition: leave(DUR.fast) },
};

/* Reader / comic open like a window growing out of the shelf. */
export const zoomInVariants = {
  initial: { opacity: 0, scale: 1.012 },
  animate: { opacity: 1, scale: 1, transition: { duration: DUR.page, ease: EASE } },
  exit: { opacity: 0, scale: 0.994, transition: leave(DUR.fast) },
};

/* Edge-attached sheets (inspectors). */
export const sheetVariants = (from = 'right') => {
  const axis = from === 'left' ? '-1' : '1';
  return {
    initial: { x: `${axis === '1' ? 100 : -100}%` },
    animate: { x: 0, transition: SPRING.panel },
    exit: { x: `${axis === '1' ? 100 : -100}%`, transition: leave(DUR.base) },
  };
};

export const backdropVariants = {
  initial: { opacity: 0 },
  animate: { opacity: 1, transition: { duration: DUR.slow, ease: EASE_SOFT } },
  exit: { opacity: 0, transition: leave(DUR.base) },
};

/* Dialogs: settle from slightly smaller + higher. */
export const modalVariants = {
  initial: { opacity: 0, y: 12, scale: 0.97 },
  animate: { opacity: 1, y: 0, scale: 1, transition: SPRING.modal },
  exit: { opacity: 0, y: 8, scale: 0.985, transition: leave(DUR.fast) },
};

export const toastVariants = {
  initial: { opacity: 0, y: 18, scale: 0.97 },
  animate: { opacity: 1, y: 0, scale: 1, transition: SPRING.toast },
  exit: { opacity: 0, y: 10, scale: 0.985, transition: leave(DUR.fast) },
};

/* Lists: 20ms cadence, cap the cascade so long grids never crawl. */
export const staggerContainer = (step = 0.02, delay = 0.04) => ({
  hidden: { opacity: 0 },
  show: {
    opacity: 1,
    transition: { staggerChildren: step, delayChildren: delay },
  },
});

export const riseItem = {
  hidden: { opacity: 0, y: 10 },
  show: { opacity: 1, y: 0, transition: SPRING.card },
};

export const settleItem = {
  hidden: { opacity: 0, y: 8, scale: 0.995 },
  show: { opacity: 1, y: 0, scale: 1, transition: SPRING.card },
};
