/**
 * 动效套件：把「皮肤」映射到「动效词汇」。
 *
 * 为什么要有这一层：
 *   皮肤切换以前只换了颜色和圆角，动效仍是 Apple 那一套（交叉淡化 + 临界阻尼）。
 *   结果 MIUI 皮肤看起来像"换了配色的 iOS"——形似而神不似。
 *   动效是风格的一半，所以皮肤必须连"怎么动"一起切。
 *
 * 用法：
 *   const kit = useMotionKit();
 *   <motion.div variants={kit.page} … />
 *   <motion.header transition={kit.chrome} … />
 *
 * 约束：所有套件必须提供同名同形状的键，否则切皮肤时会漏动画。
 *   page / zoom / sheet(from) / backdrop / modal / toast
 *   stagger(step,delay) / rise / settle
 *   spring / dur / ease / chrome / section(dir)
 *
 * 三套参数来自旧版 motion.js / motion-miui.js / motion-obsidian.js，
 * 原样保留数值与注释，只把「引擎」统一到 motion（framer-motion 的 ES 入口）。
 */
import { useSettings } from '../store/AppStore.jsx';

/* ---------------------------------------------------------------- Apple */

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

/* ---------------------------------------------------------------- MIUI */

/* HyperOS 的 "standard" 曲线：起步极快、尾巴很长，是"推进"的手感来源。 */
const M_EASE = [0.2, 0, 0, 1];
/* 出场比入场更干脆，避免退场拖尾挡住下一次操作。 */
const M_EASE_IN = [0.4, 0, 1, 1];

const M_DUR = { instant: 0.08, fast: 0.16, base: 0.22, slow: 0.3, page: 0.34 };

const M_SPRING = {
  tap: { type: 'spring', stiffness: 700, damping: 34, mass: 0.55 },
  control: { type: 'spring', stiffness: 520, damping: 30, mass: 0.7 },
  surface: { type: 'spring', stiffness: 380, damping: 32, mass: 0.85 },
  pop: { type: 'spring', stiffness: 620, damping: 27, mass: 0.6 },
  chrome: { type: 'spring', stiffness: 420, damping: 34, mass: 0.8 },
};

const mFadeOut = (duration = M_DUR.fast) => ({ duration, ease: M_EASE_IN });

const MIUI = {
  id: 'miui',
  page: {
    initial: { opacity: 0, x: 34, scale: 0.986 },
    animate: {
      opacity: 1,
      x: 0,
      scale: 1,
      transition: { ...M_SPRING.surface, opacity: { duration: M_DUR.base, ease: M_EASE } },
    },
    exit: { opacity: 0, x: -18, scale: 0.992, transition: mFadeOut() },
  },
  zoom: {
    initial: { opacity: 0, scale: 0.94, y: 10 },
    animate: { opacity: 1, scale: 1, y: 0, transition: M_SPRING.pop },
    exit: { opacity: 0, scale: 0.97, y: 6, transition: mFadeOut() },
  },
  sheet: (from = 'right') => {
    const x = from === 'left' ? -100 : 100;
    return {
      initial: { x },
      animate: { x: 0, transition: M_SPRING.surface },
      exit: { x, transition: { duration: M_DUR.base, ease: M_EASE_IN } },
    };
  },
  backdrop: {
    initial: { opacity: 0 },
    animate: { opacity: 1, transition: { duration: M_DUR.fast, ease: M_EASE } },
    exit: { opacity: 0, transition: { duration: M_DUR.base, ease: M_EASE_IN } },
  },
  modal: {
    initial: { opacity: 0, scale: 0.92, y: 16 },
    animate: { opacity: 1, scale: 1, y: 0, transition: M_SPRING.pop },
    exit: { opacity: 0, scale: 0.96, y: 10, transition: mFadeOut() },
  },
  toast: {
    initial: { opacity: 0, y: 28, scale: 0.94 },
    animate: { opacity: 1, y: 0, scale: 1, transition: M_SPRING.pop },
    exit: { opacity: 0, y: 14, scale: 0.97, transition: mFadeOut() },
  },
  stagger: (step = 0.026, delay = 0.06) => ({
    hidden: { opacity: 0 },
    show: { opacity: 1, transition: { staggerChildren: step, delayChildren: delay } },
  }),
  rise: {
    hidden: { opacity: 0, y: 14, scale: 0.972 },
    show: { opacity: 1, y: 0, scale: 1, transition: M_SPRING.surface },
  },
  settle: {
    hidden: { opacity: 0, y: 10, scale: 0.985 },
    show: { opacity: 1, y: 0, scale: 1, transition: M_SPRING.control },
  },
  spring: M_SPRING,
  dur: M_DUR,
  ease: M_EASE,
  chrome: M_SPRING.chrome,
  section: (dir = 1) => ({
    initial: { opacity: 0, x: dir * 26 },
    animate: { opacity: 1, x: 0, transition: M_SPRING.surface },
    exit: { opacity: 0, x: dir * -20, transition: { duration: M_DUR.fast, ease: M_EASE_IN } },
  }),
};

/* ------------------------------------------------------------ Obsidian */

const O_EASE = [0.16, 1, 0.3, 1];
const O_EASE_IN = [0.4, 0, 1, 1];

const O_DUR = { instant: 0.1, fast: 0.18, base: 0.26, slow: 0.36, page: 0.42 };

const O_SPRING = {
  surface: { type: 'spring', stiffness: 260, damping: 30, mass: 0.9 },
  card: { type: 'spring', stiffness: 300, damping: 27, mass: 0.85 },
  pop: { type: 'spring', stiffness: 380, damping: 24, mass: 0.8 },
  toast: { type: 'spring', stiffness: 460, damping: 24, mass: 0.7 },
  chrome: { type: 'spring', stiffness: 420, damping: 34, mass: 0.85 },
};

/* 统一的 3D 变换串：五个函数的顺序必须完全一致，否则 Motion 会整段跳变。 */
const oView = (rx, ry, z, s) =>
  `perspective(1600px) rotateX(${rx}deg) rotateY(${ry}deg) translateZ(${z}px) scale(${s})`;

const oLeave = (duration) => ({ duration, ease: O_EASE_IN });

const OBSIDIAN = {
  id: 'obsidian',
  page: {
    initial: { opacity: 0, transform: oView(2, -9, -140, 0.965) },
    animate: { opacity: 1, transform: oView(0, 0, 0, 1), transition: { duration: O_DUR.page, ease: O_EASE } },
    exit: { opacity: 0, transform: oView(-1.5, 6, -110, 0.975), transition: oLeave(O_DUR.fast) },
  },
  zoom: {
    initial: { opacity: 0, transform: oView(6, 0, -240, 0.9) },
    animate: { opacity: 1, transform: oView(0, 0, 0, 1), transition: { duration: O_DUR.page, ease: O_EASE } },
    exit: { opacity: 0, transform: oView(-4, 0, -170, 0.94), transition: oLeave(O_DUR.fast) },
  },
  sheet: (from = 'right') => {
    const x = from === 'left' ? -100 : 100;
    return {
      initial: { x },
      animate: { x: 0, transition: O_SPRING.surface },
      exit: { x, transition: { duration: O_DUR.base, ease: O_EASE_IN } },
    };
  },
  backdrop: {
    initial: { opacity: 0 },
    animate: { opacity: 1, transition: { duration: O_DUR.fast, ease: O_EASE } },
    exit: { opacity: 0, transition: oLeave(O_DUR.base) },
  },
  modal: {
    initial: { opacity: 0, transform: oView(9, 0, -140, 0.94) },
    animate: { opacity: 1, transform: oView(0, 0, 0, 1), transition: O_SPRING.pop },
    exit: { opacity: 0, transform: oView(4, 0, -100, 0.97), transition: oLeave(O_DUR.fast) },
  },
  toast: {
    initial: { opacity: 0, y: 26, scale: 0.96 },
    animate: { opacity: 1, y: 0, scale: 1, transition: O_SPRING.toast },
    exit: { opacity: 0, y: 12, scale: 0.98, transition: oLeave(O_DUR.fast) },
  },
  stagger: (step = 0.03, delay = 0.05) => ({
    hidden: { opacity: 0 },
    show: { opacity: 1, transition: { staggerChildren: step, delayChildren: delay } },
  }),
  rise: {
    hidden: { opacity: 0, y: 14, transform: oView(3, 0, -60, 0.985) },
    show: { opacity: 1, y: 0, transform: oView(0, 0, 0, 1), transition: O_SPRING.card },
  },
  settle: {
    hidden: { opacity: 0, y: 9, scale: 0.99 },
    show: { opacity: 1, y: 0, scale: 1, transition: O_SPRING.card },
  },
  spring: O_SPRING,
  dur: O_DUR,
  ease: O_EASE,
  chrome: O_SPRING.chrome,
  section: (dir = 1) => ({
    initial: { opacity: 0, transform: oView(0, dir * 11, -110, 0.975) },
    animate: { opacity: 1, transform: oView(0, 0, 0, 1), transition: O_SPRING.surface },
    exit: {
      opacity: 0,
      transform: oView(0, dir * -8, -80, 0.985),
      transition: { duration: O_DUR.fast, ease: O_EASE_IN },
    },
  }),
};

export const MOTION_KITS = { apple: APPLE, miui: MIUI, obsidian: OBSIDIAN };

export const motionKitFor = (skin) =>
  skin === 'miui' ? MIUI : skin === 'obsidian' ? OBSIDIAN : APPLE;

/** 当前皮肤的动效套件。皮肤只在设置里改，重渲染成本可以忽略。 */
export function useMotionKit() {
  const settings = useSettings();
  return motionKitFor(settings?.skin);
}
