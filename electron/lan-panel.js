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
    paragraphs: [],
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
    if (!entry) return book.kind === 'cloud' ? '云端书 · 请在桌面端打开' : '还没开始读';
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

  async function openBook(book) {
    if (!state.allowWrite) {
      toast('桌面端关闭了进度写入，这里是只读面板');
      return;
    }
    if (book.kind !== 'local') {
      const entry = state.progress[book.id];
      toast(entry ? `云端书在桌面端读 · 当前 ${Math.round(pct(entry))}%` : '云端书请在桌面端打开');
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
      toast(payload?.error === 'cloud' ? '云端书请在桌面端打开' : payload?.error || '读不到这本书');
      return;
    }

    state.current = book;
    state.paragraphs = splitParagraphs(payload.text || '');
    state.lastIndex = Math.max(0, Number(state.progress[book.id]?.paraIndex) || 0);
    state.leaving = false;
    state.dirty = false;
    el.readerBook.textContent = book.name || '未命名';
    const entry = state.progress[book.id] || null;
    el.readerChapter.textContent = entry?.chapterTitle || '';

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
    el.paper.appendChild(frag);

    el.shelfView.hidden = true;
    el.readerView.hidden = false;
    el.foot.hidden = true;
    document.body.classList.add('reading');

    // 按 paraIndex 恢复（和桌面端同一口径）。段落用了 content-visibility，
    // 视口外的真实高度是浏览器估算的，所以先 scrollIntoView 让它把这一段渲染出来，
    // 下一帧再用真实 offsetTop 校正一次，位置才准。
    const start = Math.max(0, Math.min(Math.max(0, state.paragraphs.length - 1), Number(entry?.paraIndex) || 0));
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

    setSync('live', '已同步');
    history.pushState({ reader: book.id }, '', `#${encodeURIComponent(book.id)}`);
  }

  function closeReader() {
    if (!state.current) return;
    flushProgress(true);
    state.current = null;
    state.paragraphs = [];
    state.lastIndex = 0;
    state.dirty = false;
    el.readerView.hidden = true;
    el.shelfView.hidden = false;
    el.foot.hidden = false;
    document.body.classList.remove('reading');
    el.readerScroll.scrollTop = 0;
    el.paper.textContent = '';
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
    const percent = Math.max(0, Math.min(100, (index / total) * 100));
    el.readerPct.textContent = `${percent < 1 && index > 0 ? '<1' : Math.round(percent)}%`;
    el.footBar.style.width = `${percent.toFixed(2)}%`;
    return percent;
  }

  function onScroll() {
    // 页面正在离开时的滚动不是用户在滚（多半是滚动条消失引起的重排），不能拿去覆盖位置
    if (!state.current || state.leaving) return;
    const index = currentIndex();
    state.lastIndex = index;
    updateFoot(index);
    state.dirty = true;
    clearTimeout(state.saveTimer);
    state.saveTimer = setTimeout(() => flushProgress(false), 1100);
  }

  async function flushProgress(immediate) {
    if (!state.current || !state.dirty) return;
    const book = state.current;
    // 离开页面（pagehide / 切后台）时布局已经开始失效，elementFromPoint 会算偏几段。
    // 这种情况下用最后一次滚动记下的索引 —— 它才是用户真正停下的地方。
    const useLast = immediate || state.leaving || !state.lastIndex;
    const index = useLast ? state.lastIndex || currentIndex() : currentIndex();
    const percent = updateFoot(index);
    const data = {
      paraIndex: index,
      percent,
      updatedAt: Date.now(),
    };
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

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && state.current) closeReader();
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
