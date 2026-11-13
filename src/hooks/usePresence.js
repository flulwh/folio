import { useEffect, useState } from 'react';

/**
 * 给「抽屉 / 弹窗」用的存在性开关。
 *
 * AnimatePresence 在个别情况下（组件树在退出动画期间被重渲染）会漏掉卸载，
 * 结果留下一个已经 opacity:0 却仍铺满全屏的遮罩——界面看着正常，点哪都没反应，
 * 但键盘快捷键还活着。这里用一个兜底计时器保证它一定会被移出 DOM：
 * 关闭后先让 framer 播完退出动画（默认 320ms），再把子节点从树上摘掉。
 */
export function usePresence(open, exitMs = 320) {
  const [alive, setAlive] = useState(Boolean(open));

  useEffect(() => {
    if (open) {
      setAlive(true);
      return undefined;
    }
    const timer = setTimeout(() => setAlive(false), exitMs);
    return () => clearTimeout(timer);
  }, [open, exitMs]);

  return alive;
}

export default usePresence;
