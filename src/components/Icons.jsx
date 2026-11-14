import React from 'react';

const base = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.6,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  viewBox: '0 0 24 24',
  'aria-hidden': true,
};

export function IconBook({ size = 20, ...rest }) {
  return (
    <svg width={size} height={size} {...base} {...rest}>
      <path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H19v15.5H6.5A2.5 2.5 0 0 0 4 21V5.5Z" />
      <path d="M4 18.5A2.5 2.5 0 0 1 6.5 16H19" />
      <path d="M8.5 7.5h6" />
    </svg>
  );
}

export function IconPlus({ size = 20, ...rest }) {
  return (
    <svg width={size} height={size} {...base} {...rest}>
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

export function IconSearch({ size = 18, ...rest }) {
  return (
    <svg width={size} height={size} {...base} {...rest}>
      <circle cx="11" cy="11" r="6.5" />
      <path d="m16 16 4 4" />
    </svg>
  );
}

export function IconBookmark({ size = 18, ...rest }) {
  return (
    <svg width={size} height={size} {...base} {...rest}>
      <path d="M7 4.5h10v15l-5-3.6-5 3.6v-15Z" />
    </svg>
  );
}

export function IconHighlight({ size = 18, ...rest }) {
  return (
    <svg width={size} height={size} {...base} {...rest}>
      <path d="M5 19h14" />
      <path d="M8.2 15.3 15.8 7.7a1.9 1.9 0 0 1 2.7 2.7l-7.6 7.6-3.5.8.8-3.5Z" />
    </svg>
  );
}

export function IconNote({ size = 18, ...rest }) {
  return (
    <svg width={size} height={size} {...base} {...rest}>
      <path d="M6 3.5h8l5 5v12H6v-17Z" />
      <path d="M14 3.5v5h5M9 12.5h6M9 16h4" />
    </svg>
  );
}

export function IconTrash({ size = 18, ...rest }) {
  return (
    <svg width={size} height={size} {...base} {...rest}>
      <path d="M4 7h16M9.5 7V5h5v2M6.5 7l1 13h9l1-13" />
      <path d="M10.5 11v5M13.5 11v5" />
    </svg>
  );
}

export function IconArrowLeft({ size = 20, ...rest }) {
  return (
    <svg width={size} height={size} {...base} {...rest}>
      <path d="M15 5l-7 7 7 7" />
    </svg>
  );
}

export function IconList({ size = 20, ...rest }) {
  return (
    <svg width={size} height={size} {...base} {...rest}>
      <path d="M8 6h12M8 12h12M8 18h12" />
      <circle cx="4" cy="6" r="1" fill="currentColor" stroke="none" />
      <circle cx="4" cy="12" r="1" fill="currentColor" stroke="none" />
      <circle cx="4" cy="18" r="1" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function IconType({ size = 20, ...rest }) {
  return (
    <svg width={size} height={size} {...base} {...rest}>
      <path d="M4 6h10M9 6v13M7 19h4" />
      <path d="M14 11h6M17 11v8M15.5 19h3" />
    </svg>
  );
}

export function IconPlay({ size = 18, ...rest }) {
  return (
    <svg width={size} height={size} {...base} {...rest}>
      <path d="M7 4.5v15l12-7.5-12-7.5Z" />
    </svg>
  );
}

export function IconPause({ size = 18, ...rest }) {
  return (
    <svg width={size} height={size} {...base} {...rest}>
      <path d="M8 5v14M16 5v14" />
    </svg>
  );
}

export function IconMaximize({ size = 18, ...rest }) {
  return (
    <svg width={size} height={size} {...base} {...rest}>
      <path d="M4 9V4h5M20 15v5h-5M20 9V4h-5M4 15v5h5" />
    </svg>
  );
}

export function IconX({ size = 18, ...rest }) {
  return (
    <svg width={size} height={size} {...base} {...rest}>
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  );
}

export function IconChevron({ size = 16, ...rest }) {
  return (
    <svg width={size} height={size} {...base} {...rest}>
      <path d="m9 6 6 6-6 6" />
    </svg>
  );
}

export function IconSparkle({ size = 18, ...rest }) {
  return (
    <svg width={size} height={size} {...base} {...rest}>
      <path d="M12 3.5 13.8 9l5.2 1.8-5.2 1.8L12 18l-1.8-5.4L5 10.8 10.2 9 12 3.5Z" />
      <path d="M18.5 4v3M20 5.5h-3" />
    </svg>
  );
}

export function IconCloud({ size = 18, ...rest }) {
  return (
    <svg width={size} height={size} {...base} {...rest}>
      <path d="M7.2 18h9.3a3.6 3.6 0 0 0 .5-7.2 5.2 5.2 0 0 0-10-1.4A3.9 3.9 0 0 0 7.2 18Z" />
    </svg>
  );
}

export function IconRefresh({ size = 18, ...rest }) {
  return (
    <svg width={size} height={size} {...base} {...rest}>
      <path d="M20 5v5h-5" />
      <path d="M4 19v-5h5" />
      <path d="M19.5 10a8 8 0 0 0-14-3M4.5 14a8 8 0 0 0 14 3" />
    </svg>
  );
}

export function IconDatabase({ size = 18, ...rest }) {
  return (
    <svg width={size} height={size} {...base} {...rest}>
      <ellipse cx="12" cy="5.5" rx="7" ry="2.7" />
      <path d="M5 5.5v6.7c0 1.5 3.1 2.7 7 2.7s7-1.2 7-2.7V5.5" />
      <path d="M5 12.2v6.3c0 1.5 3.1 2.7 7 2.7s7-1.2 7-2.7v-6.3" />
    </svg>
  );
}

export function IconGrid({ size = 18, ...rest }) {
  return (
    <svg width={size} height={size} {...base} {...rest}>
      <rect x="4" y="4" width="6.5" height="6.5" rx="1.4" />
      <rect x="13.5" y="4" width="6.5" height="6.5" rx="1.4" />
      <rect x="4" y="13.5" width="6.5" height="6.5" rx="1.4" />
      <rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1.4" />
    </svg>
  );
}

export function IconShare({ size = 18, ...rest }) {
  return (
    <svg width={size} height={size} {...base} {...rest}>
      <path d="M12 15V4M8.5 7.5 12 4l3.5 3.5" />
      <path d="M5 13v5.5A1.5 1.5 0 0 0 6.5 20h11a1.5 1.5 0 0 0 1.5-1.5V13" />
    </svg>
  );
}

/** 键盘 / 快捷键 */
export function IconCommand({ size = 18, ...rest }) {
  return (
    <svg width={size} height={size} {...base} {...rest}>
      <rect x="2.5" y="6" width="19" height="12" rx="2.2" />
      <path d="M6.5 10h.01M10 10h.01M13.5 10h.01M17 10h.01M8 14h8" />
    </svg>
  );
}

/** 终端 / 日志 */
export function IconTerminal({ size = 18, ...rest }) {
  return (
    <svg width={size} height={size} {...base} {...rest}>
      <rect x="3" y="4.5" width="18" height="15" rx="2.5" />
      <path d="m7 10 2.5 2L7 14" />
      <path d="M12.5 14.5H17" />
    </svg>
  );
}

/** 设置 / 齿轮 */
export function IconSettings({ size = 18, ...rest }) {
  return (
    <svg width={size} height={size} {...base} {...rest}>
      <circle cx="12" cy="12" r="3.1" />
      <path d="M19.2 14.9a1.6 1.6 0 0 0 .3 1.8l.1.1a1.9 1.9 0 1 1-2.7 2.7l-.1-.1a1.6 1.6 0 0 0-1.8-.3 1.6 1.6 0 0 0-1 1.5v.2a1.9 1.9 0 1 1-3.8 0v-.1a1.6 1.6 0 0 0-1-1.5 1.6 1.6 0 0 0-1.8.3l-.1.1a1.9 1.9 0 1 1-2.7-2.7l.1-.1a1.6 1.6 0 0 0 .3-1.8 1.6 1.6 0 0 0-1.5-1H3a1.9 1.9 0 1 1 0-3.8h.1a1.6 1.6 0 0 0 1.5-1 1.6 1.6 0 0 0-.3-1.8l-.1-.1a1.9 1.9 0 1 1 2.7-2.7l.1.1a1.6 1.6 0 0 0 1.8.3h.1a1.6 1.6 0 0 0 1-1.5V3a1.9 1.9 0 1 1 3.8 0v.1a1.6 1.6 0 0 0 1 1.5 1.6 1.6 0 0 0 1.8-.3l.1-.1a1.9 1.9 0 1 1 2.7 2.7l-.1.1a1.6 1.6 0 0 0-.3 1.8v.1a1.6 1.6 0 0 0 1.5 1h.2a1.9 1.9 0 1 1 0 3.8h-.1a1.6 1.6 0 0 0-1.5 1Z" />
    </svg>
  );
}

/** 书堆 / 书库 */
export function IconBooks({ size = 20, ...rest }) {
  return (
    <svg width={size} height={size} {...base} {...rest}>
      <rect x="3.2" y="4" width="4.2" height="13" rx="0.9" />
      <rect x="8.6" y="4" width="4.2" height="13" rx="0.9" />
      <path d="M15.1 5.1l3.9 1.1-3.5 12.6" />
      <path d="M4.5 19.5h15" />
    </svg>
  );
}

export function IconFolder({ size = 20, ...rest }) {
  return (
    <svg width={size} height={size} {...base} {...rest}>
      <path d="M3.5 7.2A1.7 1.7 0 0 1 5.2 5.5h4l1.7 1.8h6.9a1.7 1.7 0 0 1 1.7 1.7v7.3a1.7 1.7 0 0 1-1.7 1.7H5.2a1.7 1.7 0 0 1-1.7-1.7V7.2Z" />
    </svg>
  );
}
