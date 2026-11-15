/**
 * Motion system — Obsidian（黑曜）flavoured.
 *
 * 和前两套刻意不同：Apple 是「沉降」、MIUI 是「回弹推进」，
 * Obsidian 是**纵深**——界面不是一张平面在淡入淡出，而是一层层玻璃
 * 在三维空间里被推进/拉远。三套共用的键必须齐全，切皮肤时才不会漏动画。
 *
 * 三条原则（决定了下面每个数字）：
 *  1. 所有页面转场都带 perspective + translateZ：入场从 -140px 的深处推上来，
 *     退场往 -110px 沉回去。眼睛读到的是「换了一层」，不是「换了一张图」。
 *  2. 旋转非常小（1.5°–10°）。它能暗示体积，但一旦超过 12° 就会变成 PPT 翻页，
 *     阅读器里的文字也会跟着糊，所以上限压死。
 *  3. 弹簧比 Apple 硬、比 MIUI 稳：ζ ≈ .82–.88，落定后有一下极轻的呼吸，
 *     不能晃。玻璃要有重量。
 *
 * Reduced motion 由 MotionConfig 统一抹平 transform，这里不重复写降级。
 */

/* 长尾收束：玻璃滑到位之后还要"贴住"底，所以尾巴比 iOS 更长 */
export const EASE = [0.16, 1, 0.3, 1];
/* 退场要干脆：多一帧都会让下一层玻璃显得迟疑 */
export const EASE_IN = [0.4, 0, 1, 1];

export const DUR = {
  instant: 0.1,
  fast: 0.18,
  base: 0.26,
  slow: 0.36,
  page: 0.42,
};

/* 阻尼比 = damping / (2·√(stiffness·mass)) */
export const SPRING = {
  /* 260 / 0.9 → ζ ≈ .88：面板，重玻璃滑到位 */
  surface: { type: 'spring', stiffness: 260, damping: 30, mass: 0.9 },
  /* 300 / 0.85 → ζ ≈ .84：封面、列表项 */
  card: { type: 'spring', stiffness: 300, damping: 27, mass: 0.85 },
  /* 380 / 0.8 → ζ ≈ .80：弹窗，一次轻微过冲 */
  pop: { type: 'spring', stiffness: 380, damping: 24, mass: 0.8 },
  /* 460 / 0.7 → ζ ≈ .78：提示条，最轻的一层 */
  toast: { type: 'spring', stiffness: 460, damping: 24, mass: 0.7 },
  /* 420 / 0.85 → ζ ≈ .93：阅读器上下工具栏，不能晃到正文 */
  chrome: { type: 'spring', stiffness: 420, damping: 34, mass: 0.85 },
};

/**
 * 统一的 3D 变换串。
 * 五个函数的顺序必须完全一致，否则 Motion 无法逐项插值，会整段跳变。
 */
const view = (rx, ry, z, s) =>
  `perspective(1600px) rotateX(${rx}deg) rotateY(${ry}deg) translateZ(${z}px) scale(${s})`;

const leave = (duration) => ({ duration, ease: EASE_IN });

/* 整页切换：旧层下沉、新层从深处推上来 */
export const pageVariants = {
  initial: { opacity: 0, transform: view(2, -9, -140, 0.965) },
  animate: {
    opacity: 1,
    transform: view(0, 0, 0, 1),
    transition: { duration: DUR.page, ease: EASE },
  },
  exit: { opacity: 0, transform: view(-1.5, 6, -110, 0.975), transition: leave(DUR.fast) },
};

/* 进书：像把书从书架里抽出来，整个窗口向前逼近 */
export const zoomInVariants = {
  initial: { opacity: 0, transform: view(6, 0, -240, 0.9) },
  animate: {
    opacity: 1,
    transform: view(0, 0, 0, 1),
    transition: { duration: DUR.page, ease: EASE },
  },
  exit: { opacity: 0, transform: view(-4, 0, -170, 0.94), transition: leave(DUR.fast) },
};

/* 边缘面板：从贴边滑入，落定后有一点点"贴住"的回弹 */
export const sheetVariants = (from = 'right') => {
  const sign = from === 'left' ? -1 : 1;
  return {
    initial: { x: sign * 100 },
    animate: { x: 0, transition: SPRING.surface },
    exit: { x: sign * 100, transition: { duration: DUR.base, ease: EASE_IN } },
  };
};

/* 遮罩：两层玻璃交叠时底色要快速压暗，否则会透出下面的内容 */
export const backdropVariants = {
  initial: { opacity: 0 },
  animate: { opacity: 1, transition: { duration: DUR.fast, ease: EASE } },
  exit: { opacity: 0, transition: leave(DUR.base) },
};

/* 弹窗：从深处浮到面前 */
export const modalVariants = {
  initial: { opacity: 0, transform: view(9, 0, -140, 0.94) },
  animate: {
    opacity: 1,
    transform: view(0, 0, 0, 1),
    transition: SPRING.pop,
  },
  exit: { opacity: 0, transform: view(4, 0, -100, 0.97), transition: leave(DUR.fast) },
};

/* 提示条固定在底部，不能上 perspective，只做位移 + 缩放 */
export const toastVariants = {
  initial: { opacity: 0, y: 26, scale: 0.96 },
  animate: { opacity: 1, y: 0, scale: 1, transition: SPRING.toast },
  exit: { opacity: 0, y: 12, scale: 0.98, transition: leave(DUR.fast) },
};

/* 列表级联：30ms 一拍，配合每项 40px 的景深差，像一叠玻璃依次归位 */
export const staggerContainer = (step = 0.03, delay = 0.05) => ({
  hidden: { opacity: 0 },
  show: { opacity: 1, transition: { staggerChildren: step, delayChildren: delay } },
});

export const riseItem = {
  hidden: { opacity: 0, y: 14, transform: view(3, 0, -60, 0.985) },
  show: { opacity: 1, y: 0, transform: view(0, 0, 0, 1), transition: SPRING.card },
};

export const settleItem = {
  hidden: { opacity: 0, y: 9, scale: 0.99 },
  show: { opacity: 1, y: 0, scale: 1, transition: SPRING.card },
};

/* 设置页分区：按导航方向侧向推进，同时轻微转一点角度 */
export const sectionVariants = (dir = 1) => ({
  initial: { opacity: 0, transform: view(0, dir * 11, -110, 0.975) },
  animate: {
    opacity: 1,
    transform: view(0, 0, 0, 1),
    transition: SPRING.surface,
  },
  exit: {
    opacity: 0,
    transform: view(0, dir * -8, -80, 0.985),
    transition: { duration: DUR.fast, ease: EASE_IN },
  },
});

export const chromeTransition = SPRING.chrome;
