import { useCallback, useEffect, useRef, useState } from 'react';

const UI_IDLE_MS = 2500;

/**
 * 阅读器工具栏的显隐：鼠标移动/点按唤醒，闲置一段时间自动隐藏。
 *
 * 从 Reader.jsx 抽出来。overlaysOpenRef 由 Reader 每帧写入（面板是否打开），
 * 闲置回调靠它避免把正在看面板的界面藏起来。
 */
export function useReaderUiVisibility({ autoHideUI, panelOpen, overlaysOpenRef }) {
  const [uiVisible, setUiVisible] = useState(true);
  const idleTimer = useRef(null);

  const wakeUI = useCallback(() => {
    setUiVisible(true);
    if (idleTimer.current) clearTimeout(idleTimer.current);
    if (autoHideUI) {
      idleTimer.current = setTimeout(() => {
        if (!overlaysOpenRef.current) setUiVisible(false);
      }, UI_IDLE_MS);
    }
  }, [autoHideUI, overlaysOpenRef]);

  useEffect(() => {
    wakeUI();
    return () => {
      if (idleTimer.current) clearTimeout(idleTimer.current);
    };
  }, [wakeUI]);

  useEffect(() => {
    let last = 0;
    const onMove = () => {
      const now = Date.now();
      if (now - last < 120) return;
      last = now;
      wakeUI();
    };
    window.addEventListener('mousemove', onMove, { passive: true });
    return () => window.removeEventListener('mousemove', onMove);
  }, [wakeUI]);

  // 面板打开时保持工具栏可见，并暂停闲置计时。
  useEffect(() => {
    if (panelOpen) {
      setUiVisible(true);
      if (idleTimer.current) clearTimeout(idleTimer.current);
    } else {
      wakeUI();
    }
  }, [panelOpen, wakeUI]);

  return { uiVisible, setUiVisible, wakeUI };
}
