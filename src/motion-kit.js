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
 */
import * as apple from './motion.js';
import * as miui from './motion-miui.js';
import { useSettings } from './store/AppStore.jsx';

const APPLE_KIT = {
  id: 'apple',
  page: apple.pageVariants,
  zoom: apple.zoomInVariants,
  sheet: apple.sheetVariants,
  backdrop: apple.backdropVariants,
  modal: apple.modalVariants,
  toast: apple.toastVariants,
  stagger: apple.staggerContainer,
  rise: apple.riseItem,
  settle: apple.settleItem,
  spring: apple.SPRING,
  dur: apple.DUR,
  ease: apple.EASE,
  /* 阅读器上下工具栏：保持原有手感（这段是 Apple 风格里最"窗口化"的一处） */
  chrome: { duration: 0.35, ease: [0.22, 1, 0.36, 1] },
  /* 设置页分区：分区切换按导航方向推拉 */
  section: (dir) => ({
    initial: { opacity: 0, x: dir * 16 },
    animate: { opacity: 1, x: 0, transition: apple.SPRING.panel },
    exit: { opacity: 0, x: dir * -12, transition: { duration: 0.18, ease: [0.4, 0, 0.2, 1] } },
  }),
};

const MIUI_KIT = {
  id: 'miui',
  page: miui.pageVariants,
  zoom: miui.zoomInVariants,
  sheet: miui.sheetVariants,
  backdrop: miui.backdropVariants,
  modal: miui.modalVariants,
  toast: miui.toastVariants,
  stagger: miui.staggerContainer,
  rise: miui.riseItem,
  settle: miui.settleItem,
  spring: miui.MI_SPRING,
  dur: miui.MI_DUR,
  ease: miui.MI_EASE,
  chrome: miui.chromeTransition,
  section: miui.sectionVariants,
};

export const MOTION_KITS = { apple: APPLE_KIT, miui: MIUI_KIT };

export const motionKitFor = (skin) => (skin === 'miui' ? MIUI_KIT : APPLE_KIT);

/** 当前皮肤的动效套件。皮肤只在设置里改，重渲染成本可以忽略。 */
export function useMotionKit() {
  const settings = useSettings();
  return settings?.skin === 'miui' ? MIUI_KIT : APPLE_KIT;
}
