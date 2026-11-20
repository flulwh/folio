import { useRef, useState } from 'react';
import { clamp } from '../utils/format.js';

/**
 * 底部进度条拖动：按住/拖动时预览位置，松手后落位。
 *
 * 从 Reader.jsx 抽出来。轨道刻度是全书口径，云端书只装了一个章节窗口，
 * 所以拖动中把比例换算成窗口内的章内位置预览，落在窗口外的章节等松手再换窗。
 */
export function useReaderScrubber({
  scrollRef,
  trackRef,
  cloud,
  windowBase,
  chapters,
  paragraphCount,
  getTotal,
  scrollToIndex,
  scrollToOffset,
  stopSmooth,
  setAutoScroll,
  playSettle,
  wakeUI,
}) {
  const [scrub, setScrub] = useState(null);
  const scrubRef = useRef(false);
  const seekRatioRef = useRef(0);

  const seekTo = (clientX) => {
    const el = scrollRef.current;
    const track = trackRef.current;
    if (!el || !track) return 0;
    const rect = track.getBoundingClientRect();
    const ratio = clamp((clientX - rect.left) / rect.width, 0, 1);
    seekRatioRef.current = ratio;
    if (cloud?.chapters?.length) {
      // 云端书：轨道是全书口径，先换算到「当前窗口内的章内位置」做即时预览；
      // 落在窗口外的部分要等松手再交给 onJump 换窗口（拖动过程中不反复拉章节）。
      const localPos = ratio * cloud.chapters.length - windowBase;
      if (localPos >= 0 && localPos < chapters.length) {
        const target = Math.min(chapters.length - 1, Math.floor(localPos));
        const start = chapters[target]?.paraIndex ?? 0;
        const next = chapters[target + 1]?.paraIndex ?? paragraphCount;
        scrollToIndex(start + Math.round((next - start) * (localPos - target)));
      }
      return ratio * 100;
    }
    const max = Math.max(0, getTotal() - el.clientHeight);
    scrollToOffset(ratio * max);
    return ratio * 100;
  };

  const onTrackDown = (e) => {
    e.preventDefault();
    stopSmooth();
    setAutoScroll(false);
    scrubRef.current = true;
    e.currentTarget.setPointerCapture?.(e.pointerId);
    setScrub(seekTo(e.clientX));
    wakeUI();
  };

  const onTrackMove = (e) => {
    if (!scrubRef.current) return;
    setScrub(seekTo(e.clientX));
  };

  const onTrackUp = (e) => {
    if (!scrubRef.current) return;
    scrubRef.current = false;
    e.currentTarget.releasePointerCapture?.(e.pointerId);
    setScrub(null);
    playSettle();
    if (cloud?.chapters?.length) {
      const target = Math.min(
        cloud.chapters.length - 1,
        Math.max(0, Math.floor(seekRatioRef.current * cloud.chapters.length))
      );
      const local = target - windowBase;
      if (local < 0 || local >= chapters.length) cloud.onJump?.(target);
    }
  };

  return { scrub, onTrackDown, onTrackMove, onTrackUp };
}
