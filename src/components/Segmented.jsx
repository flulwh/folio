import React, { useId } from 'react';
import { motion } from 'framer-motion';
import { useMotionKit } from '../motion-kit.js';

/**
 * Apple 风格分段控件（Segmented Control）。
 *
 * 与普通 segmented 的区别：选中态是一块会「滑过去」的拇指，而不是硬切背景。
 * - 拇指用 layoutId + 弹簧跟随：Apple 阻尼比 ≈ .99（落定），MIUI ≈ .79（回弹）
 * - 文字颜色交叉淡化，选中项与未选中项同时在场，切换时亮度渐变
 * - 语义上是 tablist：roving tabindex，键盘可达、aria-selected 同步
 * - 皮肤差异：两套皮肤都用这块拇指，但弹簧不同 —— Apple 近乎临界阻尼
 *   （panel），MIUI 刻意欠阻尼（control），滑动末尾能看见一点过冲。
 *   MIUI 版本以前是"隐藏拇指、硬切底色"，那是效果最少的一种做法；
 *   改成滑动的白色药丸后，切换的连续性才和 MIUI 的手感对上。
 */
export default function Segmented({ options, value, onChange, full = false, className = '', style, ariaLabel }) {
  const kit = useMotionKit();
  /* 选中项的字色由皮肤决定：Apple 用文字色（选中=更黑），MIUI 用主色
     （选中=更蓝）。夜间用 --mi-seg-active —— 它就是为此准备的一档更亮的蓝，
     直接拿 --accent 在近黑底上对比度不够。
     这个颜色必须写在这里：framer 的内联样式优先级高于 CSS，
     否则 miui-motion.css 里那条 active 颜色规则永远不生效。 */
  const activeInk = kit.id === 'miui' ? 'var(--mi-seg-active, var(--accent))' : 'var(--text)';
  const layoutId = useId();
  const items = Array.isArray(options) ? options : [];

  return (
    <div
      className={`segmented${full ? ' full' : ''}${className ? ` ${className}` : ''}`}
      style={style}
      role="tablist"
      aria-label={ariaLabel}
    >
      {items.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="tab"
            aria-selected={active}
            tabIndex={active ? 0 : -1}
            className={`segmented-item${active ? ' active' : ''}`}
            style={option.style}
            onClick={() => onChange?.(option.value)}
          >
            {active && (
              <motion.span
                className="segmented-thumb"
                layoutId={`${layoutId}-thumb`}
                transition={kit.spring.control}
                aria-hidden="true"
              />
            )}
            <motion.span
              className="segmented-label"
              animate={{ color: active ? activeInk : 'var(--text-soft)' }}
              transition={{ duration: 0.16 }}
            >
              {option.label}
            </motion.span>
          </button>
        );
      })}
    </div>
  );
}
