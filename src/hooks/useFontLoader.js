import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * 用户安装字体的加载与管理。
 *
 * 流程：
 * 1. 主进程把字体文件复制到 dataDir/fonts/，返回元信息（族名、文件名、格式）。
 * 2. 这里用 FontFace API 把每个字体注册进文档，族名统一加前缀 `FolioUser_`，
 *    避免和系统字体重名冲突（用户装个「宋体」不该覆盖系统的 SimSun）。
 * 3. 渲染层通过 CSS 变量 `--font-user-<id>` 引用，选中哪款就切哪个变量。
 *
 * 为什么不直接写 @font-face 样式标签：
 * FontFace API 能拿到加载结果（成功/失败），字体没加载成功时可以明确回退，
 * 不会静默变成系统默认字体让人以为「装错了」。
 */

/** 族名前缀：与系统字体隔离，同时在 DevTools 里一眼看出是用户装的。 */
const FAMILY_PREFIX = 'FolioUser_';

/** 把族名转成能安全用在 CSS 里的标识符。 */
function toCssIdent(name) {
  return String(name || '')
    .replace(/[^\w一-龥-]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '');
}

/** 字体 id → CSS 变量名。 */
export function fontVarName(id) {
  return `--font-user-${id}`;
}

/** 字体 id → FontFace 使用的族名。 */
export function fontFamilyName(id) {
  return `${FAMILY_PREFIX}${toCssIdent(id)}`;
}

/**
 * 字体文件在渲染进程里的可访问 URL。
 * dev 下页面是 http://localhost，prod 下是 file://，都不能直接读本地路径，
 * 所以主进程开了 folio-font:// 协议。
 */
function fontUrl(file) {
  return `folio-font://font/${encodeURIComponent(file)}`;
}

/** 字体格式 → CSS font format 关键字。 */
function cssFormat(format) {
  switch (String(format || '').toLowerCase()) {
    case 'ttf':
      return 'truetype';
    case 'otf':
      return 'opentype';
    case 'woff':
      return 'woff';
    case 'woff2':
      return 'woff2';
    case 'ttc':
      return 'truetype';
    default:
      return '';
  }
}

/**
 * 字体是否含中文字形 —— 数据来自主进程读 cmap 的结果，不在渲染层检测。
 *
 * 为什么不在浏览器里测：
 * - document.fonts.check(family, '汉') 在 Chromium 里会把 fallback 算进去，
 *   纯西文字体同样返回 true。
 * - canvas 画「汉」时浏览器自动 fallback 到系统中文字体，
 *   画出来的是别的字体的字形，墨迹计数与像素比对都不可靠
 *   （实测 Candara 与系统 fallback 的像素完全一致）。
 *
 * cmap 是字体「我有哪些字形」的唯一权威声明，读它没有歧义。
 */

/**
 * @param {object[]} fonts 主进程返回的字体元信息列表
 * @returns {{ loaded: object[], failed: object[], cjk: object, ready: boolean }}
 */
export function useFontLoader(fonts) {
  const [loaded, setLoaded] = useState([]);
  const [failed, setFailed] = useState([]);
  const [cjk, setCjk] = useState({});
  // 正在加载的 FontFace 对象，避免重复注册
  const facesRef = useRef(new Map());

  useEffect(() => {
    const faces = facesRef.current;
    let cancelled = false;

    const list = Array.isArray(fonts) ? fonts : [];

    (async () => {
      const okList = [];
      const failList = [];
      const cjkMap = {};

      for (const font of list) {
        if (!font?.id || !font?.file) continue;
        const family = fontFamilyName(font.id);
        const existing = faces.get(font.id);
        if (existing) {
          okList.push(font);
          continue;
        }

        try {
          const face = new FontFace(family, `url(${fontUrl(font.file)}) format("${cssFormat(font.format)}")`);
          const parsed = await face.load();
          document.fonts.add(parsed);
          faces.set(font.id, parsed);
          okList.push(font);
        } catch (err) {
          failList.push({ ...font, error: err?.message || '加载失败' });
        }
      }

      // 中文字形标记来自主进程读 cmap 的结果（权威），
      // 浏览器侧的检测会被 fallback 干扰，所以不采用。
      for (const font of list) {
        if (font?.id && typeof font.hasCJK === 'boolean') cjkMap[font.id] = font.hasCJK;
      }

      if (cancelled) return;
      setLoaded(okList);
      setFailed(failList);
      setCjk(cjkMap);

      // 字体加载完会让行高变化，通知外层重新测量
      try {
        await document.fonts.ready;
        document.documentElement.setAttribute('data-fonts-ready', '1');
      } catch {
        /* ignore */
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [fonts]);

  // 卸载时把注册过的字体摘掉，避免 FontFace 泄漏
  useEffect(() => {
    const faces = facesRef.current;
    return () => {
      for (const face of faces.values()) {
        try {
          document.fonts.delete(face);
        } catch {
          /* ignore */
        }
      }
      faces.clear();
    };
  }, []);

  return { loaded, failed, cjk, ready: loaded.length > 0 };
}

/**
 * 生成选中字体的 CSS font-family 值。
 * 用户字体优先，回退到基础字体族，保证字形缺失时仍可读。
 */
export function fontStackFor(fontId, fallback = 'sans') {
  if (!fontId) return `var(--font-${fallback})`;
  return `"${fontFamilyName(fontId)}", var(--font-${fallback})`;
}
