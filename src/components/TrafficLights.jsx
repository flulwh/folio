import React, { useCallback, useEffect, useState } from 'react';

/**
 * macOS 风格交通灯（红黄绿三个圆点）。
 *
 * 为什么自己画：
 *  macOS 系统自带 traffic light，位置和样式都是原生最准的；但 Windows 没有。
 *  想让两个平台的窗口外观一致，只能在 Windows 上把原生标题栏去掉
 *  （titleBarStyle: 'hidden'），然后在渲染层自绘这三个按钮。
 *
 * 细节照 macOS 的规矩来：
 *  - 静止时只有三个灰点（不显示符号），鼠标移上去才浮现 × / − / ⛶
 *  - 三个按钮各自独立 hover，悬停时才显示符号
 *  - 颜色是 macOS 的经典三色：#ff5f57 / #febc2e / #28c840
 *  - 点中间那个是「最小化」，绿点是「最大化 / 还原」，红点是「关闭」
 *
 * 交互限制：
 *  - 按钮区域是 no-drag，否则点不动（拖拽区会吃掉点击）
 *  - 双击标题栏空白处 = 最大化 / 还原，跟 macOS 一致
 *  - 键盘 Alt/Option + 关闭窗口是系统级行为，这里不重复实现
 */
export default function TrafficLights({ onDoubleClickBlank }) {
  const [hover, setHover] = useState(null);
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    let alive = true;
    const read = () => {
      const api = window.readerAPI;
      if (!api?.windowIsMaximized) return;
      Promise.resolve(api.windowIsMaximized())
        .then((value) => {
          if (alive) setMaximized(Boolean(value));
        })
        .catch(() => {});
    };
    read();
    // 系统最大化 / 还原后按钮图标要跟着变
    const onResize = () => read();
    window.addEventListener('resize', onResize);
    return () => {
      alive = false;
      window.removeEventListener('resize', onResize);
    };
  }, []);

  const minimize = useCallback(() => {
    window.readerAPI?.windowMinimize?.();
  }, []);

  const toggleMaximize = useCallback(() => {
    Promise.resolve(window.readerAPI?.windowToggleMaximize?.())
      .then((value) => setMaximized(Boolean(value)))
      .catch(() => {});
  }, []);

  const close = useCallback(() => {
    window.readerAPI?.windowClose?.();
  }, []);

  return (
    <div className="traffic-lights" onDoubleClick={onDoubleClickBlank}>
      <button
        type="button"
        className="traffic-dot traffic-close"
        aria-label="关闭窗口"
        title="关闭"
        onClick={close}
        onMouseEnter={() => setHover('close')}
        onMouseLeave={() => setHover(null)}
      >
        {hover === 'close' ? <span className="traffic-glyph">×</span> : null}
      </button>
      <button
        type="button"
        className="traffic-dot traffic-minimize"
        aria-label="最小化窗口"
        title="最小化"
        onClick={minimize}
        onMouseEnter={() => setHover('minimize')}
        onMouseLeave={() => setHover(null)}
      >
        {hover === 'minimize' ? <span className="traffic-glyph">−</span> : null}
      </button>
      <button
        type="button"
        className="traffic-dot traffic-maximize"
        aria-label={maximized ? '还原窗口' : '最大化窗口'}
        title={maximized ? '还原' : '最大化'}
        onClick={toggleMaximize}
        onMouseEnter={() => setHover('maximize')}
        onMouseLeave={() => setHover(null)}
      >
        {hover === 'maximize' ? (
          <span className="traffic-glyph">{maximized ? '⤡' : '+'}</span>
        ) : null}
      </button>
    </div>
  );
}
