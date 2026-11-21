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
 * - 选中项用文字色（选中 = 更黑），拇指走 Apple 的临界阻尼弹簧，滑动末尾不晃
 *
 * 为什么不用 layoutId：framer-motion 11 的 presence 记账在
 * 「带 layoutId 的元素在 AnimatePresence 子树里卸载」时会留下永不结束的退出项，
 * 面板永远是「正在退出」，既关不掉也挡住点击。拇指改成常驻 + 动画位移就绕开了。
 */
export default function Segmented({ options, value, onChange, full = false, className = '', style, ariaLabel }) {
  const kit = useMotionKit();
  /* 选中项的字色必须写在内联样式里：framer 的内联优先级高于 CSS，
     皮肤层想改 active 颜色也压不过它。 */
  const activeInk = 'var(--text)';
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
