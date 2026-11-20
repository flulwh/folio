import { createContext, useContext, useEffect, useMemo, useState } from 'react';

const ThemeContext = createContext(null);

function initialMode() {
  return document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
}

export function ThemeProvider({ children }) {
  const [mode, setMode] = useState(initialMode);

  useEffect(() => {
    document.documentElement.dataset.theme = mode;
    try {
      localStorage.setItem('blog-theme', mode);
    } catch {
      /* 隐私模式下忽略 */
    }
  }, [mode]);

  const value = useMemo(
    () => ({ mode, setMode, toggle: () => setMode((current) => (current === 'dark' ? 'light' : 'dark')) }),
    [mode],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  return useContext(ThemeContext);
}
