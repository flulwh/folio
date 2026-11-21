/**
 * 动效套件：桌面端只有一套「Apple 沉降」词汇。
 *
 * 用法：
 *   const kit = useMotionKit();
 *   <motion.div variants={kit.page} … />
 *   <motion.header transition={kit.chrome} … />
 *
 * 约束：套件必须提供固定形状的键，否则调用处会漏动画。
 *   page / zoom / sheet(from) / backdrop / modal / toast
 *   stagger(step,delay) / rise / settle
 *   spring / dur / ease / chrome / section(dir)
 */

/* Apple 的 "ease"：大面（面板、页面）移动。 */
const A_EASE = [0.32, 0.72, 0, 1];
/* 控件统一缓动：hover / press / 小动效。 */
const A_EASE_SOFT = [0.4, 0, 0.2, 1];

const A_DUR = { instant: 0.12, fast: 0.18, base: 0.24, slow: 0.32, page: 0.36 };

/* 阻尼比 = damping / (2·√(stiffness·mass)) */
const A_SPRING = {
  panel: { type: 'spring', stiffness: 320, damping: 34, mass: 0.92 },
  card: { type: 'spring', stiffness: 280, damping: 25, mass: 0.9 },
  modal: { type: 'spring', stiffness: 400, damping: 28, mass: 0.85 },
  toast: { type: 'spring', stiffness: 460, damping: 26, mass: 0.8 },
  /* 分段控件的拇指：短距离、要跟手，刚度比面板高一档 */
  control: { type: 'spring', stiffness: 520, damping: 38, mass: 0.6 },
};

const aLeave = (duration) => ({ duration, ease: A_EASE });

const APPLE = {
  id: 'apple',
  page: {
    initial: { opacity: 0, scale: 0.992 },
    animate: { opacity: 1, scale: 1, transition: { duration: A_DUR.page, ease: A_EASE } },
    exit: { opacity: 0, scale: 0.996, transition: aLeave(A_DUR.fast) },
  },
  zoom: {
    initial: { opacity: 0, scale: 1.012 },
    animate: { opacity: 1, scale: 1, transition: { duration: A_DUR.page, ease: A_EASE } },
    exit: { opacity: 0, scale: 0.994, transition: aLeave(A_DUR.fast) },
  },
  sheet: (from = 'right') => {
    const x = from === 'left' ? '-100%' : '100%';
    return {
      initial: { x },
      animate: { x: 0, transition: A_SPRING.panel },
      exit: { x, transition: aLeave(A_DUR.base) },
    };
  },
  backdrop: {
    initial: { opacity: 0 },
    animate: { opacity: 1, transition: { duration: A_DUR.slow, ease: A_EASE_SOFT } },
    exit: { opacity: 0, transition: aLeave(A_DUR.base) },
  },
  modal: {
    initial: { opacity: 0, y: 12, scale: 0.97 },
    animate: { opacity: 1, y: 0, scale: 1, transition: A_SPRING.modal },
    exit: { opacity: 0, y: 8, scale: 0.985, transition: aLeave(A_DUR.fast) },
  },
  toast: {
    initial: { opacity: 0, y: 18, scale: 0.97 },
    animate: { opacity: 1, y: 0, scale: 1, transition: A_SPRING.toast },
    exit: { opacity: 0, y: 10, scale: 0.985, transition: aLeave(A_DUR.fast) },
  },
  stagger: (step = 0.02, delay = 0.04) => ({
    hidden: { opacity: 0 },
    show: { opacity: 1, transition: { staggerChildren: step, delayChildren: delay } },
  }),
  rise: {
    hidden: { opacity: 0, y: 10 },
    show: { opacity: 1, y: 0, transition: A_SPRING.card },
  },
  settle: {
    hidden: { opacity: 0, y: 8, scale: 0.995 },
    show: { opacity: 1, y: 0, scale: 1, transition: A_SPRING.card },
  },
  spring: A_SPRING,
  dur: A_DUR,
  ease: A_EASE,
  /* 阅读器上下工具栏：Apple 风格里最"窗口化"的一处。 */
  chrome: { duration: 0.35, ease: [0.22, 1, 0.36, 1] },
  section: (dir) => ({
    initial: { opacity: 0, x: dir * 16 },
    animate: { opacity: 1, x: 0, transition: A_SPRING.panel },
    exit: { opacity: 0, x: dir * -12, transition: { duration: 0.18, ease: A_EASE_SOFT } },
  }),
};

export const MOTION_KITS = { apple: APPLE };

export const motionKitFor = () => APPLE;

/** 动效套件（只有一套，保留函数名让调用处读起来一致）。 */
export function useMotionKit() {
  return APPLE;
}
