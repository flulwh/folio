import React, { useId } from 'react';
import { motion } from 'framer-motion';
import { SPRING } from '../motion.js';

/**
 * Apple 风格分段控件（Segmented Control）。
 *
 * 与普通 segmented 的区别：选中态是一块会「滑过去」的拇指，而不是硬切背景。
 * - 拇指用 layoutId + 弹簧跟随：阻尼比 ≈ .99（panel），移动连贯、无来回抖
 * - 文字颜色交叉淡化，选中项与未选中项同时在场，切换时亮度渐变
 * - 语义上是 tablist：roving tabindex，键盘可达、aria-selected 同步
 * - 皮肤差异：MIUI 皮肤自带实色选中块，由 skin-miui.css 隐藏拇指，保持原观感
 */
export default function Segmented({ options, value, onChange, full = false, className = '', style, ariaLabel }) {
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
                transition={SPRING.panel}
                aria-hidden="true"
              />
            )}
            <motion.span
              className="segmented-label"
              animate={{ color: active ? 'var(--text)' : 'var(--text-soft)' }}
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
