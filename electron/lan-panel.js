/* ------------------------------------------------------------------
   Folio 局域网面板前端
   纯原生 JS，不打包、不依赖任何库 —— 手机浏览器打开就能用。
   数据全部来自 /api/*，进度写入走 POST /api/progress，桌面端的改动通过 SSE 推过来。
   ------------------------------------------------------------------ */
(() => {
  'use strict';

  /* ---------------- 内置主题（与 src/themes.js 保持一致） ---------------- */

  const BUILTIN_THEMES = {
    paper: {
      tone: 'light',
      tokens: {
        bg: '#faf8f4', bgElevated: '#fffefb', bgSunken: '#f1ede4', text: '#1c1815',
        textSoft: '#5c554c', textFaint: '#736c63', line: 'rgba(28, 24, 19, 0.13)',
        accent: '#b1402c', accentSoft: 'rgba(177, 64, 44, 0.085)',
      },
    },
    sepia: {
      tone: 'light',
      tokens: {
        bg: '#f2e9d8', bgElevated: '#fbf4e6', bgSunken: '#e8dcc6', text: '#2a2119',
        textSoft: '#6b5b47', textFaint: '#726247', line: 'rgba(74, 54, 28, 0.16)',
        accent: '#9c4a1a', accentSoft: 'rgba(156, 74, 26, 0.09)',
      },
    },
    night: {
      tone: 'dark',
      tokens: {
        bg: '#121114', bgElevated: '#1a191d', bgSunken: '#0c0b0e', text: '#e6e2da',
        textSoft: '#9c968c', textFaint: '#8a847b', line: 'rgba(230, 226, 218, 0.13)',
        accent: '#d4644c', accentSoft: 'rgba(212, 100, 76, 0.14)',
      },
    },
    forest: {
      tone: 'light',
      tokens: {
        bg: '#f2f4f3', bgElevated: '#fbfcfb', bgSunken: '#e7ebe8', text: '#1a221f',
        textSoft: '#586560', textFaint: '#66706a', line: 'rgba(24, 40, 34, 0.13)',
        accent: '#2f6b52', accentSoft: 'rgba(47, 107, 82, 0.09)',
      },
    },
  };

  const TOKEN_VARS = {
    bg: '--bg', bgElevated: '--surface', bgSunken: '--sunken', text: '--text',
    textSoft: '--soft', textFaint: '--faint', line: '--line',
    accent: '--accent', accentSoft: '--accent-soft',
  };

  const $ = (id) => document.getElementById(id);
  const el = {
    app: $('app'),
    topbar: document.querySelector('.topbar'),
    syncDot: $('syncDot'),
    refresh: $('refresh'),
    shelfView: $('shelfView'),
    hero: $('hero'),
    grid: $('grid'),
    empty: $('empty'),
    bookCount: $('bookCount'),
    readOnlyNote: $('readOnlyNote'),
    readerView: $('readerView'),
    readerScroll: $('readerScroll'),
    paper: $('paper'),
    readerBook: $('readerBook'),
    readerChapter: $('readerChapter'),
    readerPct: $('readerPct'),
    footBar: $('footBar'),
    footState: $('footState'),
    backToShelf: $('backToShelf'),
    fontUp: $('fontUp'),
    fontDown: $('fontDown'),
    prevChapter: $('prevChapter'),
    nextChapter: $('nextChapter'),
    tocSheet: $('tocSheet'),
    tocList: $('tocList'),
    tocCount: $('tocCount'),
    tocClose: $('tocClose'),
    toast: $('toast'),
    foot: $('foot'),
  };

  const state = {
    books: [],
    progress: {},
    theme: { id: 'paper' },
    server: {},
    allowWrite: true,
    current: null,
    mode: 'local', // local：整本 txt 一次取回；cloud：按章取
    paragraphs: [],
    toc: null, // 云端书目录 [{ i, title }]，没加载完是 null
    tocTotal: 0,
    chapter: 0,
    chapterTitle: '',
    chapterLoading: false,
    cards: new Map(),
    dirty: false,
    leaving: false, // 页面正在隐藏：停止一切重新测量的动作
    lastIndex: 0, // 最后一次确认的段落索引：离开页面时靠它，不重新测量
    saveTimer: null,
    toastTimer: null,
    hintAt: 0,
    stream: null,
  };

  /* ---------------- 工具 ---------------- */

  function escapeHtml(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, (ch) => (
      { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]
    ));
  }

  function toast(message, ms = 2200) {
    el.toast.textContent = message;
    el.toast.dataset.show = '1';
    clearTimeout(state.toastTimer);
    state.toastTimer = setTimeout(() => {
      el.toast.dataset.show = '0';
    }, ms);
  }

  function setSync(mode, title) {
    el.syncDot.dataset.state = mode;
    if (title) el.syncDot.title = title;
  }

  function pct(entry) {
    const value = Number(entry?.percent);
    if (!Number.isFinite(value)) return 0;
    return Math.max(0, Math.min(100, value));
  }

  function agoText(ts) {
    const time = Number(ts) || 0;
    if (!time) return '';
    const diff = Date.now() - time;
    if (diff < 60e3) return '刚刚';
    if (diff < 3600e3) return `${Math.floor(diff / 60e3)} 分钟前`;
    if (diff < 86400e3) return `${Math.floor(diff / 3600e3)} 小时前`;
    if (diff < 7 * 86400e3) return `${Math.floor(diff / 86400e3)} 天前`;
    return new Date(time).toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' });
  }

  function applyTheme(theme) {
    const custom = Array.isArray(theme?.custom)
      ? theme.custom.find((item) => item && item.id === theme.id && item.tokens?.bg && item.tokens?.text)
      : null;
    const builtin = BUILTIN_THEMES[theme?.id] || BUILTIN_THEMES.paper;
    const tokens = custom?.tokens || builtin.tokens;
    const tone = (custom?.tone || builtin.tone) === 'dark' ? 'dark' : 'light';
    document.documentElement.dataset.tone = tone;
    const root = document.documentElement;
    for (const [key, varName] of Object.entries(TOKEN_VARS)) {
      const value = tokens[key];
      if (value) root.style.setProperty(varName, value);
      else root.style.removeProperty(varName);
    }
    const meta = document.querySelector('meta[name="color-scheme"]');
    if (meta) meta.setAttribute('content', tone === 'dark' ? 'dark' : 'light');
  }

  /* ---------------- 分段（与 src/utils/chapters.js 对齐，保证 paraIndex 一致） ---------------- */

  const SENTENCE_END_RE = /[。！？…!?；;]["”’』」）)]\s*$/;
  const OPENING_RE = /^[「『“"‘'（(【[［]/;
  const LATIN_END_RE = /[A-Za-z0-9.,;:!?)\]}]$/;
  const LATIN_START_RE = /^[A-Za-z0-9(（]/;

  function splitParagraphs(text) {
    const lines = String(text || '').split('\n');
    const out = [];
    let buffer = [];
    const flush = () => {
      if (!buffer.length) return;
      const joined = buffer.join('').trim();
      if (joined) out.push({ text: joined, blank: false });
      buffer = [];
    };
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) {
        flush();
        if (out.length && !out[out.length - 1].blank) out.push({ text: '', blank: true });
        continue;
      }
      const prev = buffer.length ? buffer[buffer.length - 1] : null;
      if (prev !== null && !SENTENCE_END_RE.test(prev) && !OPENING_RE.test(trimmed) && prev.length > 24) {
        const glue = LATIN_END_RE.test(prev) && LATIN_START_RE.test(trimmed) ? ' ' : '';
        buffer[buffer.length - 1] = prev + glue + trimmed;
      } else {
        flush();
        buffer.push(trimmed);
      }
    }
    flush();
    while (out.length && out[out.length - 1].blank) out.pop();
    return out;
  }

  /* ---------------- 渲染：封面 ---------------- */

  function coverNode(book, className) {
    const wrap = document.createElement('div');
    wrap.className = className;
    const hue = Number.isFinite(Number(book.hue)) ? Number(book.hue) : 24;
    const fallback = document.createElement('div');
    fallback.className = 'cover-fallback';
    fallback.style.setProperty('--hue', hue);
    fallback.textContent = book.name || '未命名';
    wrap.appendChild(fallback);
    if (book.cover) {
      const img = document.createElement('img');
      img.alt = '';
      img.loading = 'lazy';
      img.decoding = 'async';
      img.src = book.cover;
      img.addEventListener('load', () => {
        fallback.style.display = 'none';
      });
      img.addEventListener('error', () => {
        img.remove();
      });
      wrap.appendChild(img);
    }
    return wrap;
  }

  /* ---------------- 渲染：书架 ---------------- */

  function render() {
    const books = state.books;
    el.bookCount.textContent = String(books.length);
    el.empty.hidden = books.length > 0;
    el.grid.textContent = '';
    state.cards.clear();

    const frag = document.createDocumentFragment();
    books.forEach((book, i) => {
      const entry = state.progress[book.id] || null;
      const percent = pct(entry);
      const card = document.createElement('button');
      card.className = 'card';
      card.type = 'button';
      card.style.animationDelay = `${Math.min(i, 14) * 22}ms`;
      card.dataset.bookId = book.id;
      card.innerHTML = `
        <div class="card-bar"><i style="width:${percent.toFixed(1)}%"></i></div>
      `;
      card.insertBefore(coverNode(book, 'cover'), card.firstChild);
      if (book.kind === 'cloud') {
        const badge = document.createElement('span');
        badge.className = 'card-badge';
        badge.textContent = '云端';
        card.querySelector('.cover').appendChild(badge);
      }
      const title = document.createElement('p');
      title.className = 'card-title';
      title.textContent = book.name || '未命名';
      card.appendChild(title);

      const sub = document.createElement('span');
      sub.className = 'card-sub';
      sub.textContent = progressLabel(book, entry);
      card.appendChild(sub);

      card.addEventListener('click', () => openBook(book));
      frag.appendChild(card);
      state.cards.set(book.id, { card, bar: card.querySelector('.card-bar i'), sub });
    });
    el.grid.appendChild(frag);
    renderHero();
  }

  function progressLabel(book, entry) {
    if (!entry) return book.author ? String(book.author).replace(/^作者[:：]\s*/, '') : '未开始';
    const percent = Math.round(pct(entry));
    const where = entry.chapterTitle || (book.kind === 'cloud' ? '云端书' : '');
    return where ? `${percent}% · ${where}` : `${percent}%`;
  }

  function renderHero() {
    // 「继续阅读」= 最近动过的那本；没有进度就退化成第一本
    let target = null;
    let best = -1;
    for (const book of state.books) {
      const entry = state.progress[book.id];
      const at = Number(entry?.updatedAt) || 0;
      if (at > best) {
        best = at;
        target = book;
      }
    }
    if (!target) target = state.books.find((b) => b.kind === 'local') || state.books[0] || null;
    if (!target) {
      el.hero.hidden = true;
      return;
    }
    const entry = state.progress[target.id] || null;
    const percent = pct(entry);
    el.hero.hidden = false;
    el.hero.textContent = '';

    const cover = coverNode(target, 'hero-cover');
    const body = document.createElement('div');
    body.className = 'hero-body';
    body.innerHTML = `
      <div class="hero-kicker">${entry ? '继续阅读' : '开始阅读'}</div>
      <h1 class="hero-title">${escapeHtml(target.name || '未命名')}</h1>
      <div class="hero-sub">${escapeHtml(heroSub(target, entry))}</div>
      <div class="hero-row">
        <div class="mini-bar"><i style="width:${percent.toFixed(1)}%"></i></div>
        <button class="btn" type="button">${entry ? '接着读' : '打开'}</button>
      </div>
    `;
    body.querySelector('.btn').addEventListener('click', () => openBook(target));
    el.hero.append(cover, body);
  }

  function heroSub(book, entry) {
    if (!entry) return '还没开始读';
    const bits = [];
    if (entry.chapterTitle) bits.push(entry.chapterTitle);
    bits.push(`${Math.round(pct(entry))}%`);
    if (entry.updatedAt) bits.push(agoText(entry.updatedAt));
    return bits.join(' · ');
  }

  /* ---------------- 阅读 ---------------- */

  function setReadingSize(size) {
    const clamped = Math.max(14, Math.min(26, size));
    document.documentElement.style.setProperty('--reading-size', `${clamped}px`);
    try {
      localStorage.setItem('folio.lan.size', String(clamped));
    } catch {
      /* 隐私模式下不可写，忽略 */
    }
    return clamped;
  }

  /* ---------------- 阅读：公共部分 ---------------- */

  function showReader() {
    el.shelfView.hidden = true;
    el.readerView.hidden = false;
    el.foot.hidden = true;
    document.body.classList.add('reading');
    closeToc();
  }

  function showShelf() {
    el.readerView.hidden = true;
    el.shelfView.hidden = false;
    el.foot.hidden = false;
    document.body.classList.remove('reading');
    closeToc();
  }

  function readingHeader(book, title) {
    el.readerBook.textContent = book.name || '未命名';
    el.readerChapter.textContent = title || '';
  }

  /**
   * 把段落挂进正文区，并定位到 startIndex。
   *
   * 段落用了 content-visibility，视口外的真实高度是浏览器估算的，
   * 所以先 scrollIntoView 让这一段进渲染树，下一帧再用真实 offsetTop 校正。
   */
  function mountParagraphs(startIndex) {
    const frag = document.createDocumentFragment();
    state.paragraphs.forEach((item, index) => {
      const node = document.createElement('p');
      node.dataset.i = String(index);
      if (item.blank) {
        node.className = 'gap';
        node.setAttribute('aria-hidden', 'true');
      } else {
        node.textContent = item.text;
      }
      frag.appendChild(node);
    });
    el.paper.textContent = '';
    el.paper.dataset.error = '0';
    el.paper.appendChild(frag);

    const start = Math.max(0, Math.min(Math.max(0, state.paragraphs.length - 1), Number(startIndex) || 0));
    requestAnimationFrame(() => {
      const node = el.paper.querySelector(`[data-i="${start}"]`);
      if (!node) {
        updateFoot(start);
        return;
      }
      node.scrollIntoView({ block: 'start' });
      requestAnimationFrame(() => {
        el.readerScroll.scrollTop = Math.max(0, node.offsetTop - 14);
        updateFoot(start);
      });
    });
  }

  function scheduleSave() {
    state.dirty = true;
    clearTimeout(state.saveTimer);
    state.saveTimer = setTimeout(() => flushProgress(false), 1100);
  }

  /* ---------------- 阅读：本地 txt ---------------- */

  async function openBook(book) {
    // 云端书按章取，走另一条路径
    if (book?.kind === 'cloud') {
      openCloudBook(book);
      return;
    }
    setSync('saving', '正在加载正文');
    let payload = null;
    try {
      const res = await fetch(`/api/book/${encodeURIComponent(book.id)}`, { cache: 'no-store' });
      payload = await res.json();
    } catch (err) {
      setSync('off', '连接中断');
      toast('加载失败，检查一下网络');
      return;
    }
    if (!payload?.ok) {
      setSync('live', '已同步');
      toast(payload?.error || '读不到这本书');
      return;
    }

    const entry = state.progress[book.id] || null;
    state.current = book;
    state.mode = 'local';
    state.toc = null;
    state.tocTotal = 0;
    state.chapter = 0;
    state.chapterTitle = entry?.chapterTitle || '';
    state.paragraphs = splitParagraphs(payload.text || '');
    state.lastIndex = Math.max(0, Number(entry?.paraIndex) || 0);
    state.leaving = false;
    state.dirty = false;

    readingHeader(book, state.chapterTitle);
    el.readerChapter.disabled = true;
    el.readerChapter.classList.remove('link');
    el.prevChapter.hidden = true;
    el.nextChapter.hidden = true;

    showReader();
    mountParagraphs(state.lastIndex);
    setSync('live', '已同步');
    history.pushState({ reader: book.id }, '', `#${encodeURIComponent(book.id)}`);
  }

  /* ---------------- 阅读：云端书（按章取） ---------------- */

  async function openCloudBook(book) {
    const entry = state.progress[book.id] || {};
    const startChapter = Math.max(0, Number(entry.chapter ?? entry.windowBase) || 0);

    state.current = book;
    state.mode = 'cloud';
    state.toc = null;
    state.tocTotal = 0;
    state.chapter = startChapter;
    state.chapterTitle = String(entry.chapterTitle || '');
    state.paragraphs = [];
    state.lastIndex = Math.max(0, Number(entry.paraIndex) || 0);
    state.leaving = false;
    state.dirty = false;
    state.chapterLoading = false;

    readingHeader(book, state.chapterTitle || '正在获取目录…');
    el.readerChapter.disabled = false;
    el.readerChapter.classList.add('link');
    el.prevChapter.hidden = false;
    el.nextChapter.hidden = false;
    el.prevChapter.disabled = startChapter <= 0;
    el.nextChapter.disabled = false;
    el.paper.textContent = '';
    el.paper.dataset.error = '0';
    el.readerPct.textContent = '0%';
    el.footBar.style.width = '0%';

    showReader();
    history.pushState({ reader: book.id }, '', `#${encodeURIComponent(book.id)}`);
    if (!state.allowWrite) toast('只读模式：可以看，不记录进度');

    // 目录和正文并行取：目录要解析书源，往往比正文慢；串行会让「点开一本书」多等好几秒。
    loadToc(book, startChapter);
    loadChapter(startChapter, { resumeAt: state.lastIndex });
  }

  async function loadToc(book, jumpTo) {
    setSync('saving', '正在获取目录');
    try {
      const res = await fetch(`/api/toc/${encodeURIComponent(book.id)}`, { cache: 'no-store' });
      const payload = await res.json();
      if (state.current?.id !== book.id) return; // 期间已经切走了
      if (!payload?.ok) {
        toast(payload?.error || '目录没取到，只能一章一章翻');
        setSync('live', '已同步');
        return;
      }
      state.toc = Array.isArray(payload.chapters) ? payload.chapters : [];
      state.tocTotal = Number(payload.total) || state.toc.length;
      const title = state.toc[jumpTo]?.title;
      if (title) {
        state.chapterTitle = title;
        readingHeader(book, title);
      }
      el.nextChapter.disabled = state.chapter >= state.tocTotal - 1;
      renderToc(jumpTo);
      updateFoot(state.lastIndex);
      setSync('live', '已同步');
    } catch {
      if (state.current?.id !== book.id) return;
      setSync('off', '目录没取到');
      toast('目录没取到，检查一下网络');
    }
  }

  async function loadChapter(index, options = {}) {
    const book = state.current;
    if (!book || state.mode !== 'cloud' || state.chapterLoading) return;

    state.chapterLoading = true;
    state.chapter = index;
    // 目录可能已经渲染好了：跟着翻章把高亮挪过去，否则点开目录还停在旧章
    markTocCurrent(index);
    if (state.toc?.[index]?.title) state.chapterTitle = state.toc[index].title;
    readingHeader(book, state.chapterTitle || `第 ${index + 1} 章`);
    el.prevChapter.disabled = index <= 0;
    if (state.tocTotal) el.nextChapter.disabled = index >= state.tocTotal - 1;

    el.readerScroll.scrollTop = 0;
    el.paper.textContent = '';
    el.paper.dataset.error = '0';
    el.paper.dataset.loading = '1';
    setSync('saving', '正在取正文');

    try {
      const res = await fetch(`/api/chapter/${encodeURIComponent(book.id)}?i=${index}`, { cache: 'no-store' });
      const payload = await res.json();
      if (state.current?.id !== book.id || state.mode !== 'cloud') return;
      if (!payload?.ok) throw new Error(payload?.error || '这一章没有正文');

      state.paragraphs = splitParagraphs(payload.text || '');
      state.lastIndex = Math.max(0, Math.min(state.paragraphs.length - 1, Number(options.resumeAt) || 0));
      state.leaving = false;
      state.dirty = false;
      mountParagraphs(state.lastIndex);
      updateFoot(state.lastIndex);
      setSync('live', '已同步');
      // 翻到新的一章本身就是一次进度变化，不等滚动也记一笔
      scheduleSave();
    } catch (err) {
      if (state.current?.id !== book.id || state.mode !== 'cloud') return;
      state.paragraphs = [];
      state.dirty = false;
      el.paper.textContent = '';
      const node = document.createElement('p');
      node.className = 'reader-error';
      node.textContent = err?.message || '这一章没取到';
      el.paper.appendChild(node);
      el.paper.dataset.error = '1';
      setSync('off', '没取到正文');
    } finally {
      state.chapterLoading = false;
      el.paper.dataset.loading = '0';
    }
  }

  /** 切章统一入口：先把旧章停下的位置写掉，免得新章号覆盖它。 */
  function openChapter(index) {
    if (!state.current || state.mode !== 'cloud') return;
    if (index < 0) return;
    if (state.tocTotal && index >= state.tocTotal) return;
    if (index === state.chapter && state.paragraphs.length) {
      el.readerScroll.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }
    if (state.dirty && state.paragraphs.length) flushProgress(true);
    loadChapter(index, {});
  }

  /* ---------------- 目录 ---------------- */

  function markTocCurrent(index) {
    const prev = el.tocList.querySelector('.toc-row.current');
    if (prev) prev.classList.remove('current');
    const row = el.tocList.querySelector(`.toc-row[data-i="${index}"]`);
    if (row) row.classList.add('current');
  }

  function renderToc(current) {
    if (!state.toc) return;
    const frag = document.createDocumentFragment();
    state.toc.forEach((item, index) => {
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'toc-row';
      row.dataset.i = String(index);
      if (index === current) row.classList.add('current');
      const num = document.createElement('span');
      num.className = 'toc-num';
      num.textContent = String(index + 1);
      const name = document.createElement('span');
      name.className = 'toc-name';
      name.textContent = item.title || `第 ${index + 1} 章`;
      row.append(num, name);
      row.addEventListener('click', () => {
        closeToc();
        openChapter(index);
      });
      frag.appendChild(row);
    });
    el.tocList.textContent = '';
    el.tocList.appendChild(frag);
    el.tocCount.textContent = ` · ${state.toc.length}`;
  }

  function openToc() {
    if (state.mode !== 'cloud') return;
    if (!state.toc?.length) {
      toast('目录还在加载，稍等一下');
      return;
    }
    el.tocSheet.hidden = false;
    document.body.classList.add('sheet-open');
    requestAnimationFrame(() => {
      const row = el.tocList.querySelector('.toc-row.current');
      if (!row) return;
      // 用 rect 相对定位，不依赖 offsetParent：.toc-row 的 offsetTop 是相对面板的，
      // 直接拿来当 scrollTop 会多滚出半个视口。
      const listRect = el.tocList.getBoundingClientRect();
      const rowRect = row.getBoundingClientRect();
      const delta = rowRect.top - listRect.top - el.tocList.clientHeight / 2 + rowRect.height / 2;
      el.tocList.scrollTop = Math.max(0, el.tocList.scrollTop + delta);
    });
  }

  function closeToc() {
    if (el.tocSheet.hidden) return;
    el.tocSheet.hidden = true;
    document.body.classList.remove('sheet-open');
  }

  function closeReader() {
    if (!state.current) return;
    flushProgress(true);
    state.current = null;
    state.mode = 'local';
    state.paragraphs = [];
    state.toc = null;
    state.tocTotal = 0;
    state.chapter = 0;
    state.chapterTitle = '';
    state.lastIndex = 0;
    state.dirty = false;
    state.chapterLoading = false;
    el.paper.textContent = '';
    el.paper.dataset.loading = '0';
    el.readerScroll.scrollTop = 0;
    showShelf();
    history.replaceState(null, '', location.pathname + location.search);
    render();
  }

  /** 用 elementFromPoint 找当前段落：比遍历几万个 offsetTop 便宜得多。 */
  function currentIndex() {
    const rect = el.readerScroll.getBoundingClientRect();
    const x = Math.round(rect.left + rect.width / 2);
    const node = document.elementFromPoint(x, Math.round(rect.top + 8));
    const hit = node && node.closest ? node.closest('[data-i]') : null;
    if (hit) return Number(hit.dataset.i) || 0;
    // 兜底：二分找第一个底边越过视口顶部的段落
    const items = el.paper.children;
    let lo = 0;
    let hi = items.length - 1;
    let ans = 0;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (items[mid].offsetTop + items[mid].offsetHeight > el.readerScroll.scrollTop + 4) {
        ans = mid;
        hi = mid - 1;
      } else {
        lo = mid + 1;
      }
    }
    return ans;
  }

  function updateFoot(index) {
    const total = state.paragraphs.length || 1;
    const inner = Math.max(0, Math.min(1, (Number(index) || 0) / total));
    // 云端书的百分比按「第几章 + 章内位置」折成全书，和桌面端同一口径
    const percent =
      state.mode === 'cloud' && state.tocTotal > 0
        ? Math.min(100, ((state.chapter + inner) / state.tocTotal) * 100)
        : inner * 100;
    el.readerPct.textContent = `${percent > 0 && percent < 1 ? '<1' : Math.round(percent)}%`;
    el.footBar.style.width = `${percent.toFixed(2)}%`;
    return percent;
  }

  function onScroll() {
    // 页面正在离开时的滚动不是用户在滚（多半是滚动条消失引起的重排），不能拿去覆盖位置
    if (!state.current || state.leaving || !state.paragraphs.length) return;
    const index = currentIndex();
    state.lastIndex = index;
    updateFoot(index);
    scheduleSave();
  }

  async function flushProgress(immediate) {
    if (!state.current || !state.dirty) return;
    if (!state.paragraphs.length) return; // 正文还没到，没有位置可写
    if (!state.allowWrite) return; // 只读面板：能读，不记录
    const book = state.current;
    // 离开页面（pagehide / 切后台）时布局已经开始失效，elementFromPoint 会算偏几段。
    // 这种情况下用最后一次滚动记下的索引 —— 它才是用户真正停下的地方。
    const useLast = immediate || state.leaving || !state.lastIndex;
    const index = useLast ? state.lastIndex || currentIndex() : currentIndex();
    const percent = updateFoot(index);
    // 云端书的定位锚点是章号（桌面端读 chapter / windowBase），
    // paraIndex 只是章内位置，桌面端不解释它，但手机自己下次打开要用。
    const data =
      state.mode === 'cloud'
        ? {
            chapter: state.chapter,
            chapterTitle: state.chapterTitle || '',
            windowBase: state.chapter,
            paraIndex: index,
            percent,
            updatedAt: Date.now(),
          }
        : { paraIndex: index, percent, updatedAt: Date.now() };
    state.dirty = false;
    setSync('saving', '正在同步');

    const body = JSON.stringify({ id: book.id, data });
    if (immediate && navigator.sendBeacon) {
      try {
        navigator.sendBeacon('/api/progress', new Blob([body], { type: 'application/json' }));
        return;
      } catch {
        /* 退化成 fetch */
      }
    }
    try {
      const res = await fetch('/api/progress', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
        keepalive: true,
      });
      const payload = await res.json();
      if (!res.ok) {
        setSync('off', payload?.error || '同步失败');
        toast(payload?.error || '进度没存上');
        return;
      }
      // 服务端可能因为「桌面端更新更晚」而拒绝这次写入，以它返回的为准
      if (payload.entry) {
        state.progress[book.id] = payload.entry;
        patchCard(book.id);
      }
      setSync('live', '已同步');
      el.footState.textContent = payload.applied ? '已同步' : '桌面端更新更晚';
      el.footState.dataset.show = '1';
      setTimeout(() => {
        el.footState.dataset.show = '0';
      }, 1800);
    } catch {
      setSync('off', '连不上桌面端');
      state.dirty = true;
    }
  }

  /* ---------------- 增量更新（SSE 到达时不重排整页） ---------------- */

  function patchCard(id) {
    const ref = state.cards.get(id);
    if (!ref) return;
    const entry = state.progress[id] || null;
    const book = state.books.find((item) => item.id === id);
    ref.bar.style.width = `${pct(entry).toFixed(1)}%`;
    if (book) ref.sub.textContent = progressLabel(book, entry);
  }

  /* ---------------- 数据加载 ---------------- */

  async function load(silent) {
    if (!silent) setSync('saving', '正在读取');
    try {
      const res = await fetch('/api/state', { cache: 'no-store' });
      if (res.status === 401) {
        location.reload();
        return;
      }
      const data = await res.json();
      if (!data?.ok) throw new Error(data?.error || 'bad state');
      state.books = Array.isArray(data.books) ? data.books : [];
      state.progress = data.progress && typeof data.progress === 'object' ? data.progress : {};
      state.theme = data.theme || { id: 'paper' };
      state.server = data.server || {};
      state.allowWrite = data.server?.allowWrite !== false;
      el.readOnlyNote.hidden = state.allowWrite;
      applyTheme(state.theme);
      el.foot.textContent = `Folio ${state.server.version || ''} · 局域网面板 · 进度与桌面端实时同步`;
      render();
      setSync('live', '已同步');
    } catch (err) {
      setSync('off', '连不上桌面端');
      if (!silent) toast('读不到数据，确认桌面端还开着');
    }
  }

  /* ---------------- SSE ---------------- */

  function connectStream() {
    if (!window.EventSource) return;
    const stream = new EventSource('/api/events');
    state.stream = stream;

    stream.addEventListener('open', () => setSync('live', '已同步'));
    stream.addEventListener('hello', (event) => {
      try {
        const data = JSON.parse(event.data);
        state.allowWrite = data.allowWrite !== false;
        el.readOnlyNote.hidden = state.allowWrite;
      } catch {
        /* ignore */
      }
    });
    stream.addEventListener('config', (event) => {
      try {
        const data = JSON.parse(event.data);
        state.allowWrite = data.allowWrite !== false;
        el.readOnlyNote.hidden = state.allowWrite;
        toast(state.allowWrite ? '桌面端允许写入进度了' : '桌面端改成只读了');
      } catch {
        /* ignore */
      }
    });
    stream.addEventListener('progress', (event) => {
      let data;
      try {
        data = JSON.parse(event.data);
      } catch {
        return;
      }
      if (!data?.progress || typeof data.progress !== 'object') return;
      const currentId = state.current?.id || null;
      const before = currentId ? pct(state.progress[currentId]) : 0;
      state.progress = data.progress;
      for (const id of state.cards.keys()) patchCard(id);
      renderHeroIfIdle();
      if (data.origin === 'remote') return; // 自己在手机上写的，不用提示
      // 桌面端那边动了：正好是当前这本就轻提示一下，但不改滚动位置，不打断阅读
      if (currentId && state.progress[currentId] && Date.now() - state.hintAt > 6000) {
        const now = pct(state.progress[currentId]);
        if (Math.abs(now - before) > 0.5) {
          state.hintAt = Date.now();
          toast(`桌面端已同步到 ${Math.round(now)}%`);
        }
      }
    });
    stream.addEventListener('error', () => {
      setSync('off', '重新连接中');
    });
  }

  let heroRaf = 0;
  function renderHeroIfIdle() {
    // 书架视图下才重画 hero，阅读中不要动它（会打断滚动位置）
    if (state.current) return;
    cancelAnimationFrame(heroRaf);
    heroRaf = requestAnimationFrame(renderHero);
  }

  /* ---------------- 事件绑定 ---------------- */

  el.refresh.addEventListener('click', () => {
    load(false);
    toast('已刷新');
  });

  el.backToShelf.addEventListener('click', closeReader);

  el.fontUp.addEventListener('click', () => {
    const now = Number(getComputedStyle(document.documentElement).getPropertyValue('--reading-size').replace('px', '')) || 18;
    setReadingSize(now + 1);
  });
  el.fontDown.addEventListener('click', () => {
    const now = Number(getComputedStyle(document.documentElement).getPropertyValue('--reading-size').replace('px', '')) || 18;
    setReadingSize(now - 1);
  });

  el.readerScroll.addEventListener('scroll', onScroll, { passive: true });

  // 云端书：点标题开目录，底栏翻章
  el.readerChapter.addEventListener('click', () => {
    if (state.mode === 'cloud') openToc();
  });
  el.prevChapter.addEventListener('click', () => openChapter(state.chapter - 1));
  el.nextChapter.addEventListener('click', () => openChapter(state.chapter + 1));
  el.tocClose.addEventListener('click', closeToc);
  el.tocSheet.addEventListener('click', (event) => {
    if (event.target === el.tocSheet) closeToc(); // 点遮罩关闭
  });

  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    if (!el.tocSheet.hidden) {
      closeToc();
      return;
    }
    if (state.current) closeReader();
  });

  window.addEventListener('popstate', () => {
    if (state.current) closeReader();
  });

  /**
   * 页面要走的时候：先把位置钉住再存。
   * 卸载过程中浏览器会重排（滚动条消失、视口变化），这时再测量段落位置会偏几段，
   * 写回去的就不是用户真正停下的地方。所以用 lastIndex 作为唯一真相。
   */
  const markLeaving = () => {
    if (!state.current) return;
    state.leaving = true;
    // 把还在节流里的那次保存掐掉：它会在 1.1 秒后带着已经错位的位置写盘
    clearTimeout(state.saveTimer);
    if (state.dirty) flushProgress(true);
  };

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') markLeaving();
    else state.leaving = false;
  });
  window.addEventListener('pagehide', markLeaving);

  window.addEventListener('scroll', () => {
    el.topbar.classList.toggle('scrolled', window.scrollY > 4);
  }, { passive: true });

  /* ---------------- 启动 ---------------- */

  try {
    const saved = Number(localStorage.getItem('folio.lan.size'));
    if (Number.isFinite(saved) && saved) setReadingSize(saved);
  } catch {
    /* ignore */
  }

  load(false).then(() => {
    connectStream();
    // 从桌面端点「在浏览器打开」时 URL 带 #bookId，直接进那本
    const hash = location.hash.replace(/^#/, '');
    if (hash) {
      const book = state.books.find((item) => item.id === decodeURIComponent(hash));
      if (book) openBook(book);
    }
  });
})();
