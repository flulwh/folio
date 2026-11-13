/**
 * Motion system — MIUI / HyperOS flavoured.
 *
 * 和 motion.js（Apple 风）刻意是两套手感，不是同一套参数换个数字：
 *
 *  Apple  「沉降」：内容是"落定"的。位移小（8–14px）、弹簧接近临界阻尼、
 *         转场用交叉淡化 + 极轻缩放，眼睛读到的是"稳住"。
 *  MIUI   「回弹 + 推进」：界面是"有质量的物体"。按下立刻塌陷、松手弹回、
 *         转场用位移推进（push），弹簧刻意欠阻尼，收尾留一点点过冲。
 *
 * 三条原则（决定了下面每个数字）：
 *  1. 按压是瞬时的，回弹才是弹簧。按下 60–80ms 到位（用户要的是"我按到了"），
 *     松手走 spring，过冲 1~2% —— 这一对不对称是 MIUI 手感的核心。
 *  2. 层级越深，位移越大。同级（书架↔集市）推 32px，入书（→阅读器）是"生长"
 *     而非平移，弹窗从中心弹出。距离本身在解释信息结构。
 *  3. 悬停不位移，只有按压位移。桌面隐喻里鼠标悬停不是"抬起"，抖动会让
 *     一屏 20 张封面互相打架；颜色和阴影变化足够表达可点。
 *
 * Reduced motion 下 MotionConfig 会把 transform 全部抹成 opacity，
 * 所以这里不必再写一份降级变体，但要保证每个变体都带 opacity 通道。
 */

/* HyperOS 的 "standard" 曲线：起步极快、尾巴很长，是"推进"的手感来源 */
export const MI_EASE = [0.2, 0, 0, 1];
/* 出场：比入场更干脆，避免退场拖尾挡住下一次操作 */
export const MI_EASE_IN = [0.4, 0, 1, 1];

export const MI_DUR = {
  instant: 0.08,
  fast: 0.16,
  base: 0.22,
  slow: 0.3,
  page: 0.34,
};

/* 阻尼比 = damping / (2·√(stiffness·mass))，注释里标出来方便调整时对照 */
export const MI_SPRING = {
  /* 700 / 0.55 → ζ ≈ .86：按压回弹，一下到位、几乎不晃 */
  tap: { type: 'spring', stiffness: 700, damping: 34, mass: 0.55 },
  /* 520 / 0.7 → ζ ≈ .79：滑块、分段指示器，看得见一点过冲 */
  control: { type: 'spring', stiffness: 520, damping: 30, mass: 0.7 },
  /* 380 / 0.85 → ζ ≈ .89：面板、整页推进，重物落地 */
  surface: { type: 'spring', stiffness: 380, damping: 32, mass: 0.85 },
  /* 620 / 0.6 → ζ ≈ .70：弹窗、提示条，明显回弹 */
  pop: { type: 'spring', stiffness: 620, damping: 27, mass: 0.6 },
  /* 420 / 0.8 → ζ ≈ .93：阅读器工具栏这类"边缘抽屉"，要稳 */
  chrome: { type: 'spring', stiffness: 420, damping: 34, mass: 0.8 },
};

const fadeOut = (duration = MI_DUR.fast) => ({ duration, ease: MI_EASE_IN });

/**
 * 整页切换：新页从右侧推入，旧页向左让位并淡出。
 * 位移差（+34 / -18）不是对称的 —— 退场比入场少走一半，避免两页同时
 * 大幅移动造成的"整屏在抖"。
 */
export const pageVariants = {
  initial: { opacity: 0, x: 34, scale: 0.986 },
  animate: {
    opacity: 1,
    x: 0,
    scale: 1,
    transition: { ...MI_SPRING.surface, opacity: { duration: MI_DUR.base, ease: MI_EASE } },
  },
  exit: { opacity: 0, x: -18, scale: 0.992, transition: fadeOut() },
};

/**
 * 进入一本书：不是平移，是"从书架里长出来"。
 * 起点比终点小 6%，配 pop 弹簧，书像被抽出来摊开。
 */
export const zoomInVariants = {
  initial: { opacity: 0, scale: 0.94, y: 10 },
  animate: { opacity: 1, scale: 1, y: 0, transition: MI_SPRING.pop },
  exit: { opacity: 0, scale: 0.97, y: 6, transition: fadeOut() },
};

/** 边缘面板：从贴边滑入，弹簧带一点过冲，撞到边上"停住" */
export const sheetVariants = (from = 'right') => {
  const sign = from === 'left' ? -1 : 1;
  return {
    initial: { x: sign * 100 },
    animate: { x: 0, transition: MI_SPRING.surface },
    exit: { x: sign * 100, transition: { duration: MI_DUR.base, ease: MI_EASE_IN } },
  };
};

/** 遮罩：快进慢出，入场要抢在内容之前把底压暗 */
export const backdropVariants = {
  initial: { opacity: 0 },
  animate: { opacity: 1, transition: { duration: MI_DUR.fast, ease: MI_EASE } },
  exit: { opacity: 0, transition: { duration: MI_DUR.base, ease: MI_EASE_IN } },
};

/** 弹窗：从 92% 弹到 100%，中心为锚点，落定后还有一次细微回弹 */
export const modalVariants = {
  initial: { opacity: 0, scale: 0.92, y: 16 },
  animate: { opacity: 1, scale: 1, y: 0, transition: MI_SPRING.pop },
  exit: { opacity: 0, scale: 0.96, y: 10, transition: fadeOut(MI_DUR.fast) },
};

/** 提示条：从底部升起，回弹比弹窗更明显（它更轻） */
export const toastVariants = {
  initial: { opacity: 0, y: 28, scale: 0.94 },
  animate: { opacity: 1, y: 0, scale: 1, transition: MI_SPRING.pop },
  exit: { opacity: 0, y: 14, scale: 0.97, transition: fadeOut(MI_DUR.fast) },
};

/**
 * 列表级联：26ms 一拍，比 Apple 的 20ms 慢一点。
 * MIUI 的列表是"一列一列亮起来"的节奏，太快就看不出层次。
 */
export const staggerContainer = (step = 0.026, delay = 0.06) => ({
  hidden: { opacity: 0 },
  show: { opacity: 1, transition: { staggerChildren: step, delayChildren: delay } },
});

/** 列表项：从下方 14px 升起并轻微放大，和"物体被摆上桌面"一致 */
export const riseItem = {
  hidden: { opacity: 0, y: 14, scale: 0.972 },
  show: { opacity: 1, y: 0, scale: 1, transition: MI_SPRING.surface },
};

export const settleItem = {
  hidden: { opacity: 0, y: 10, scale: 0.985 },
  show: { opacity: 1, y: 0, scale: 1, transition: MI_SPRING.control },
};

/** 设置页分区推进：方向由导航顺序决定，距离比 Apple 版大一倍 */
export const sectionVariants = (dir = 1) => ({
  initial: { opacity: 0, x: dir * 26 },
  animate: { opacity: 1, x: 0, transition: MI_SPRING.surface },
  exit: { opacity: 0, x: dir * -20, transition: { duration: MI_DUR.fast, ease: MI_EASE_IN } },
});

/** 阅读器上下工具栏：从屏幕边缘滑出，带一点黏滞感 */
export const chromeTransition = MI_SPRING.chrome;
