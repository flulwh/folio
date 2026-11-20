import { motion } from 'motion/react';
import { useTheme } from '../lib/theme.jsx';

const OPTIONS = [
  { mode: 'light', label: '浅色' },
  { mode: 'dark', label: '深色' },
];

function SunIcon() {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.7">
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.7">
      <path d="M20 14.5A8.5 8.5 0 1 1 9.5 4a7 7 0 0 0 10.5 10.5Z" />
    </svg>
  );
}

export default function ThemeToggle() {
  const { mode, setMode } = useTheme();

  return (
    <div className="theme-toggle" role="group" aria-label="切换配色">
      {OPTIONS.map((option) => (
        <button
          key={option.mode}
          type="button"
          className="theme-toggle__slot"
          aria-label={option.label}
          aria-pressed={mode === option.mode}
          onClick={() => setMode(option.mode)}
        >
          {mode === option.mode && (
            <motion.span
              layoutId="theme-thumb"
              className="theme-toggle__thumb"
              transition={{ type: 'spring', stiffness: 420, damping: 34 }}
            />
          )}
          <span className="theme-toggle__icon">{option.mode === 'light' ? <SunIcon /> : <MoonIcon />}</span>
        </button>
      ))}
    </div>
  );
}
