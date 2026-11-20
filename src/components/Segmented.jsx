import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { motion } from 'motion/react';
import * as ToggleGroupPrimitive from '@radix-ui/react-toggle-group';
import { useMotionKit } from '../design/motion.js';

/**
 * Apple 风格分段控件（Segmented Control）。
 *
 * 与普通 segmented 的区别：选中态是一块会「滑过去」的拇指，而不是硬切背景。
 * - 拇指只挂一个，用 x / width 弹簧跟着选中项滑，不再靠 layoutId 跨按钮搬家
 * - 文字颜色交叉淡化，选中项与未选中项同时在场，切换时亮度渐变
 * - 交互与 aria 交给 Radix ToggleGroup（单选）：radiogroup 语义、方向键、
 *   roving tabindex 都由它管，拇指只负责画动画
 * - 皮肤差异：两套皮肤都用这块拇指，但弹簧不同 —— Apple 近乎临界阻尼
 *   （panel），MIUI 刻意欠阻尼（control），滑动末尾能看见一点过冲。
 *   MIUI 版本以前是"隐藏拇指、硬切底色"，那是效果最少的一种做法；
 *   改成滑动的白色药丸后，切换的连续性才和 MIUI 的手感对上。
 *
 * 为什么不用 layoutId：framer-motion 11 的 presence 记账在
 * 「带 layoutId 的元素在 AnimatePresence 子树里卸载」时会留下永不结束的退出项，
 * 面板永远是「正在退出」，既关不掉也挡住点击。拇指改成常驻 + 动画位移就绕开了。
 */
export default function Segmented({ options, value, onChange, full = false, className = '', style, ariaLabel }) {
  const kit = useMotionKit();
  /* 选中项的字色由皮肤决定：Apple 用文字色（选中=更黑），MIUI 用主色
     （选中=更蓝）。夜间用 --mi-seg-active —— 它就是为此准备的一档更亮的蓝，
     直接拿 --accent 在近黑底上对比度不够。
     这个颜色必须写在这里：framer 的内联样式优先级高于 CSS，
     否则 miui-motion.css 里那条 active 颜色规则永远不生效。 */
  const activeInk = kit.id === 'miui' ? 'var(--mi-seg-active, var(--accent))' : 'var(--text)';
  const items = Array.isArray(options) ? options : [];
  const wrapRef = useRef(null);
  const [thumb, setThumb] = useState(null);

  const measure = useCallback(() => {
    const wrap = wrapRef.current;
    const item = wrap?.querySelector('.segmented-item.active');
    if (!wrap || !item) return;
    const radius = getComputedStyle(item).borderRadius;
    const next = {
      x: item.offsetLeft,
      y: item.offsetTop,
      w: item.offsetWidth,
      h: item.offsetHeight,
      radius,
    };
    setThumb((prev) => (
      prev &&
      prev.x === next.x && prev.y === next.y &&
      prev.w === next.w && prev.h === next.h &&
      prev.radius === next.radius
        ? prev
        : next
    ));
  }, []);

  useLayoutEffect(() => {
    measure();
  }, [measure, value, items.length]);

  /* 面板开合、窗口缩放都会改变按钮位置，拇指要跟着重新量 */
  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap || typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(() => measure());
    observer.observe(wrap);
    return () => observer.disconnect();
  }, [measure]);

  return (
    <ToggleGroupPrimitive.Root
      ref={wrapRef}
      type="single"
      value={value == null ? '' : String(value)}
      onValueChange={(next) => {
        // 单选组允许再点一次把值清空；分段控件不接受「没有选中项」
        if (next) onChange?.(next);
      }}
      className={`segmented${full ? ' full' : ''}${className ? ` ${className}` : ''}`}
      style={{ position: 'relative', ...style }}
      aria-label={ariaLabel}
    >
      <motion.span
        className="segmented-thumb"
        aria-hidden="true"
        initial={false}
        style={{
          left: 0,
          top: thumb?.y ?? 0,
          height: thumb?.h ?? 0,
          borderRadius: thumb?.radius,
        }}
        animate={{ x: thumb?.x ?? 0, width: thumb?.w ?? 0, opacity: thumb ? 1 : 0 }}
        transition={kit.spring.control}
      />
      {items.map((option) => {
        const active = String(option.value) === String(value);
        return (
          <ToggleGroupPrimitive.Item
            key={option.value}
            type="button"
            value={String(option.value)}
            className={`segmented-item${active ? ' active' : ''}`}
            style={option.style}
          >
            <motion.span
              className="segmented-label"
              animate={{ color: active ? activeInk : 'var(--text-soft)' }}
              transition={{ duration: 0.16 }}
            >
              {option.label}
            </motion.span>
          </ToggleGroupPrimitive.Item>
        );
      })}
    </ToggleGroupPrimitive.Root>
  );
}
