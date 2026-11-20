import { useEffect, useRef } from 'react';

// 可聚焦元素：与浏览器自身的 Tab 序列尽量一致，排除 disabled、隐藏节点与 tabindex="-1"。
const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

function focusablesIn(root) {
  if (!root) return [];
  return Array.from(root.querySelectorAll(FOCUSABLE_SELECTOR)).filter(
    (node) => !node.closest('[aria-hidden="true"]') && node.getClientRects().length > 0
  );
}

/**
 * 给抽屉 / 对话框补上焦点语义。
 *
 * 打开时记住触发它的元素，把焦点送进面板；Tab / Shift+Tab 在面板内循环；
 * 关闭（open 变 false 或组件卸载）时把焦点还给触发者。
 *
 * 刻意不处理 Esc：Reader 已有全局 Esc 关面板逻辑，这里再绑一次会关两次。
 * 焦点不在面板内时（例如上层还叠着 NoteDialog）也完全放手，不去抢 Tab。
 * 面板挂载晚于 open 一帧（usePresence 两段式），所以首次聚焦用短延时等节点出现。
 */
export function useDialogFocus(open) {
  const panelRef = useRef(null);
  const openerRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;

    const active = document.activeElement;
    openerRef.current = active instanceof HTMLElement && active !== document.body ? active : null;

    const focusFirst = () => {
      const root = panelRef.current;
      if (!root || !root.isConnected) return;
      const [first] = focusablesIn(root);
      if (first) {
        first.focus({ preventScroll: true });
        return;
      }
      // 没有可聚焦子节点时焦点落在容器本身，读屏仍能进到 dialog 里。
      if (!root.hasAttribute('tabindex')) root.setAttribute('tabindex', '-1');
      root.focus({ preventScroll: true });
    };

    const timer = setTimeout(focusFirst, 50);

    const onKeyDown = (event) => {
      if (event.key !== 'Tab') return;
      const root = panelRef.current;
      if (!root || !root.isConnected) return;
      const activeEl = document.activeElement;
      if (!root.contains(activeEl)) return;

      const items = focusablesIn(root);
      if (!items.length) {
        event.preventDefault();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && (activeEl === first || activeEl === root)) {
        event.preventDefault();
        last.focus({ preventScroll: true });
      } else if (!event.shiftKey && activeEl === last) {
        event.preventDefault();
        first.focus({ preventScroll: true });
      }
    };

    document.addEventListener('keydown', onKeyDown, true);

    return () => {
      clearTimeout(timer);
      document.removeEventListener('keydown', onKeyDown, true);
      const opener = openerRef.current;
      openerRef.current = null;
      if (opener && opener.isConnected) opener.focus({ preventScroll: true });
    };
  }, [open]);

  return panelRef;
}

export default useDialogFocus;
