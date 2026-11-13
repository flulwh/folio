/* Folio 局域网面板：零依赖原生 JS。数据与桌面端同源，阅读偏好仅保存在当前浏览器。 */
(() => {
  'use strict';

  const BUILTIN_THEMES = {
    paper: { tone: 'light', tokens: { bg: '#faf8f4', bgElevated: '#fffefb', bgSunken: '#f1ede4', text: '#1c1815', textSoft: '#5c554c', textFaint: '#736c63', line: 'rgba(28, 24, 19, 0.13)', accent: '#b1402c', accentSoft: 'rgba(177, 64, 44, 0.085)' } },
    sepia: { tone: 'light', tokens: { bg: '#f2e9d8', bgElevated: '#fbf4e6', bgSunken: '#e8dcc6', text: '#2a2119', textSoft: '#6b5b47', textFaint: '#726247', line: 'rgba(74, 54, 28, 0.16)', accent: '#9c4a1a', accentSoft: 'rgba(156, 74, 26, 0.09)' } },
    night: { tone: 'dark', tokens: { bg: '#121114', bgElevated: '#1a191d', bgSunken: '#0c0b0e', text: '#e6e2da', textSoft: '#9c968c', textFaint: '#8a847b', line: 'rgba(230, 226, 218, 0.13)', accent: '#d4644c', accentSoft: 'rgba(212, 100, 76, 0.14)' } },
    forest: { tone: 'light', tokens: { bg: '#f2f4f3', bgElevated: '#fbfcfb', bgSunken: '#e7ebe8', text: '#1a221f', textSoft: '#586560', textFaint: '#66706a', line: 'rgba(24, 40, 34, 0.13)', accent: '#2f6b52', accentSoft: 'rgba(47, 107, 82, 0.09)' } },
  };
  const TOKEN_VARS = { bg: '--bg', bgElevated: '--surface', bgSunken: '--sunken', text: '--text', textSoft: '--soft', textFaint: '--faint', line: '--line', accent: '--accent', accentSoft: '--accent-soft' };
  const DEFAULT_PREFS = { size: 18, leading: 1.9, font: 'serif', measure: 'standard', theme: 'follow', layout: 'grid', sort: 'recent' };
  const MEASURES = { narrow: '32em', standard: '38em', wide: '46em' };
  const PREFS_KEY = 'folio.lan.prefs.v2';
  const $ = (id) => document.getElementById(id);
  const el = {
    topbar: document.querySelector('.topbar'), syncDot: $('syncDot'), syncText: $('syncText'), syncStatus: $('syncStatus'),
    refresh: $('refresh'), appearance: $('appearance'), offlineBar: $('offlineBar'), offlineText: $('offlineText'), retryConnection: $('retryConnection'),
    shelfView: $('shelfView'), hero: $('hero'), grid: $('grid'), empty: $('empty'), emptyTitle: $('emptyTitle'), emptyText: $('emptyText'), resetFilters: $('resetFilters'),
    bookCount: $('bookCount'), statBooks: $('statBooks'), statReading: $('statReading'), readOnlyNote: $('readOnlyNote'), bookSearch: $('bookSearch'), bookSort: $('bookSort'), bookFilters: $('bookFilters'),
    gridLayout: $('gridLayout'), listLayout: $('listLayout'),
    readerView: $('readerView'), readerScroll: $('readerScroll'), paper: $('paper'), readerBook: $('readerBook'), readerChapter: $('readerChapter'), readerMeta: $('readerMeta'),
    readerPct: $('readerPct'), progressRange: $('progressRange'), footState: $('footState'), backToShelf: $('backToShelf'), openToc: $('openToc'), readerSettings: $('readerSettings'),
    prevChapter: $('prevChapter'), nextChapter: $('nextChapter'), remoteNotice: $('remoteNotice'), remoteText: $('remoteText'), goRemote: $('goRemote'), dismissRemote: $('dismissRemote'),
    tocSheet: $('tocSheet'), tocList: $('tocList'), tocCount: $('tocCount'), tocClose: $('tocClose'), tocSearch: $('tocSearch'), tocLocate: $('tocLocate'), tocEmpty: $('tocEmpty'),
    prefsSheet: $('prefsSheet'), prefsClose: $('prefsClose'), themeChoices: $('themeChoices'), leadingChoices: $('leadingChoices'), fontChoices: $('fontChoices'), measureChoices: $('measureChoices'),
    fontUp: $('fontUp'), fontDown: $('fontDown'), fontSize: $('fontSize'), fontSizeValue: $('fontSizeValue'),
    toast: $('toast'), foot: $('foot'),
  };

  function readPrefs() {
    let saved = {};
    try {
      saved = JSON.parse(localStorage.getItem(PREFS_KEY) || '{}') || {};
      const oldSize = Number(localStorage.getItem('folio.lan.size'));
      if (!saved.size && Number.isFinite(oldSize) && oldSize) saved.size = oldSize;
    } catch { /* 隐私模式或旧数据损坏时使用默认值 */ }
    const prefs = { ...DEFAULT_PREFS, ...saved };
    prefs.size = Math.max(14, Math.min(28, Number(prefs.size) || 18));
    prefs.leading = [1.65, 1.9, 2.2].includes(Number(prefs.leading)) ? Number(prefs.leading) : 1.9;
    if (!['serif', 'sans'].includes(prefs.font)) prefs.font = 'serif';
    if (!MEASURES[prefs.measure]) prefs.measure = 'standard';
    if (!['follow', 'paper', 'sepia', 'night'].includes(prefs.theme)) prefs.theme = 'follow';
    if (!['grid', 'list'].includes(prefs.layout)) prefs.layout = 'grid';
    if (!['recent', 'added', 'title', 'progress'].includes(prefs.sort)) prefs.sort = 'recent';
    return prefs;
  }

  const state = {
    books: [], progress: {}, theme: { id: 'paper' }, server: {}, allowWrite: true,
    prefs: readPrefs(), query: '', filter: 'all', cards: new Map(),
    current: null, mode: 'local', paragraphs: [], toc: null, tocTotal: 0, chapter: 0, chapterTitle: '',
    chapterLoading: false, readerSeq: 0, localHeadings: new Set(), dirty: false, saving: false, leaving: false,
    lastIndex: 0, saveTimer: null, toastTimer: null, hintAt: 0, stream: null, remoteEntry: null,
    scrubbing: false, resizing: false, resizeTimer: null, prefRaf: 0, tocReturnFocus: null, prefsReturnFocus: null,
    gesture: null,
  };

  /* 工具与状态 */
  function escapeHtml(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  }
  function toast(message, ms = 2200) {
    el.toast.textContent = message;
    el.toast.dataset.show = '1';
    clearTimeout(state.toastTimer);
    state.toastTimer = setTimeout(() => { el.toast.dataset.show = '0'; }, ms);
  }
  function hideOffline() { el.offlineBar.hidden = true; }
  function showOffline(message) {
    el.offlineText.textContent = message || '与桌面端的连接断开了';
    el.offlineBar.hidden = false;
  }
  function setSync(mode, title) {
    const labels = { live: '已同步', saving: '同步中', off: '未连接', idle: '连接中' };
    el.syncDot.dataset.state = mode;
    el.syncText.textContent = labels[mode] || labels.idle;
    el.syncStatus.title = title || labels[mode] || '';
    if (mode === 'live' && !state.dirty) hideOffline();
    if (mode === 'off') showOffline(title);
  }
  function pct(entry) {
    const value = Number(entry?.percent);
    return Number.isFinite(value) ? Math.max(0, Math.min(100, value)) : 0;
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
  function savePrefs() {
    try { localStorage.setItem(PREFS_KEY, JSON.stringify(state.prefs)); } catch { /* ignore */ }
  }

  function applyTheme() {
    const desktop = state.theme || { id: 'paper' };
    const custom = Array.isArray(desktop.custom) ? desktop.custom.find((item) => item && item.id === desktop.id && item.tokens?.bg && item.tokens?.text) : null;
    const useDesktop = state.prefs.theme === 'follow';
    const builtin = BUILTIN_THEMES[useDesktop ? desktop.id : state.prefs.theme] || BUILTIN_THEMES.paper;
    const tokens = useDesktop ? (custom?.tokens || builtin.tokens) : builtin.tokens;
    const tone = useDesktop ? ((custom?.tone || builtin.tone) === 'dark' ? 'dark' : 'light') : builtin.tone;
    const root = document.documentElement;
    root.dataset.tone = tone;
    for (const [key, varName] of Object.entries(TOKEN_VARS)) {
      const value = tokens[key];
      if (value) root.style.setProperty(varName, value);
      else root.style.removeProperty(varName);
    }
    document.querySelector('meta[name="color-scheme"]')?.setAttribute('content', tone);
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', tokens.bg || '#faf8f4');
  }
  function renderPrefs() {
    const p = state.prefs;
    el.fontSize.value = String(p.size);
    el.fontSizeValue.textContent = `${p.size} px`;
    for (const button of el.themeChoices.querySelectorAll('button')) button.classList.toggle('active', button.dataset.themeChoice === p.theme);
    for (const button of el.leadingChoices.querySelectorAll('button')) button.classList.toggle('active', Number(button.dataset.leading) === p.leading);
    for (const button of el.fontChoices.querySelectorAll('button')) button.classList.toggle('active', button.dataset.font === p.font);
    for (const button of el.measureChoices.querySelectorAll('button')) button.classList.toggle('active', button.dataset.measure === p.measure);
  }
  function applyPrefs() {
    const p = state.prefs;
    const root = document.documentElement;
    root.style.setProperty('--reading-size', `${p.size}px`);
    root.style.setProperty('--reading-leading', String(p.leading));
    root.style.setProperty('--reading-measure', MEASURES[p.measure]);
    root.dataset.readFont = p.font;
    applyTheme();
    renderPrefs();
  }
  function preserveReadingPosition() {
    if (!state.current || !state.paragraphs.length) return;
    const index = state.lastIndex;
    cancelAnimationFrame(state.prefRaf);
    state.prefRaf = requestAnimationFrame(() => {
      const node = el.paper.querySelector(`[data-i="${index}"]`);
      if (node) el.readerScroll.scrollTop = Math.max(0, node.offsetTop - 88);
      updateFoot(index);
    });
  }
  function setPreference(key, value) {
    state.prefs[key] = value;
    savePrefs();
    applyPrefs();
    preserveReadingPosition();
  }
  function setReadingSize(size) { setPreference('size', Math.max(14, Math.min(28, Number(size) || 18))); }

  /* 与桌面端同源的段落和章节识别 */
  const SENTENCE_END_RE = /[。！？…」』”’）)]$/;
  const OPENING_RE = /^[「『“"‘'（(【[［]/;
  const LATIN_END_RE = /[A-Za-z0-9,;)]$/;
  const LATIN_START_RE = /^[A-Za-z0-9(（]/;
  const HEADING_PUNCT_RE = /[。！？!?；;]$/;
  const HEADING_CLOSE_RE = /[】」』”]$/;
  const AUTO_CHAPTER_RE = /^\s*(?:第[0-9零一二三四五六七八九十百千万两〇]+[章节節回卷部集篇话話]|(?:Chapter|CHAPTER|Part|PART|Section|SECTION)\s+[0-9IVXLCDMivxlcdm]+\b|(?:序章|序言|楔子|引子|前言|后记|後記|尾声|尾聲|终章|終章|番外|附录|附錄)|(?:[0-9]{1,4}[、.．:：]\s*\S)|(?:【[^】]{1,24}】))\s*.{0,48}$/;
  function isHeading(text) {
    const line = String(text || '').trim();
    return !!line && line.length <= 60 && !(HEADING_PUNCT_RE.test(line) && !HEADING_CLOSE_RE.test(line)) && AUTO_CHAPTER_RE.test(line);
  }
  function splitParagraphs(text) {
    const lines = String(text || '').replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').replace(/\u00a0/g, ' ').split('\n');
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
      if (prev !== null && !isHeading(trimmed) && !SENTENCE_END_RE.test(prev) && !OPENING_RE.test(trimmed) && prev.length > 24) {
        const glue = LATIN_END_RE.test(prev) && LATIN_START_RE.test(trimmed) ? ' ' : '';
        buffer[buffer.length - 1] = prev + glue + trimmed;
      } else { flush(); buffer.push(trimmed); }
    }
    flush();
    while (out.length && out[out.length - 1].blank) out.pop();
    return out;
  }
  function cleanTitle(text) { return String(text).trim().replace(/^[【\[]/, '').replace(/[】\]]$/, '').slice(0, 60); }
  function buildLocalToc(paragraphs) {
    const toc = [];
    paragraphs.forEach((item, index) => {
      if (!item.blank && isHeading(item.text)) toc.push({ title: cleanTitle(item.text), paraIndex: index });
    });
    if (!toc.length) return [];
    if (toc[0].paraIndex > 0 && paragraphs.slice(0, toc[0].paraIndex).some((item) => !item.blank)) toc.unshift({ title: '开篇', paraIndex: 0 });
    return toc;
  }
  function localChapterForPara(index) {
    if (state.mode !== 'local' || !state.toc?.length) return 0;
    let chapter = 0;
    for (let i = 1; i < state.toc.length; i += 1) {
      if (state.toc[i].paraIndex > index) break;
      chapter = i;
    }
    return chapter;
  }

  /* 封面与书架 */
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
      img.addEventListener('load', () => { fallback.style.display = 'none'; });
      img.addEventListener('error', () => { img.remove(); fallback.style.display = 'grid'; });
      wrap.appendChild(img);
    }
    return wrap;
  }
  function progressLabel(book, entry) {
    if (!entry) return book.author ? String(book.author).replace(/^作者[:：]\s*/, '') : '未开始';
    const percent = Math.round(pct(entry));
    const where = entry.chapterTitle || (book.kind === 'cloud' ? '云端书' : '');
    return where ? `${percent}% · ${where}` : `${percent}%`;
  }
  function visibleBooks() {
    const query = state.query.trim().toLocaleLowerCase('zh-CN');
    const list = state.books.filter((book) => {
      const entry = state.progress[book.id];
      if (state.filter === 'reading' && pct(entry) <= 0) return false;
      if (state.filter === 'unread' && pct(entry) > 0) return false;
      if (state.filter === 'local' && book.kind === 'cloud') return false;
      if (state.filter === 'cloud' && book.kind !== 'cloud') return false;
      if (!query) return true;
      return [book.name, book.author, book.sourceName, entry?.chapterTitle].some((value) => String(value || '').toLocaleLowerCase('zh-CN').includes(query));
    });
    const sorted = [...list];
    if (state.prefs.sort === 'title') sorted.sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'zh-CN'));
    else if (state.prefs.sort === 'progress') sorted.sort((a, b) => pct(state.progress[b.id]) - pct(state.progress[a.id]));
    else if (state.prefs.sort === 'added') sorted.sort((a, b) => (Number(b.addedAt) || 0) - (Number(a.addedAt) || 0));
    else sorted.sort((a, b) => (Number(state.progress[b.id]?.updatedAt) || Number(b.addedAt) || 0) - (Number(state.progress[a.id]?.updatedAt) || Number(a.addedAt) || 0));
    return sorted;
  }
  function renderLayout() {
    el.grid.dataset.layout = state.prefs.layout;
    const grid = state.prefs.layout === 'grid';
    el.gridLayout.classList.toggle('active', grid);
    el.listLayout.classList.toggle('active', !grid);
    el.gridLayout.setAttribute('aria-pressed', String(grid));
    el.listLayout.setAttribute('aria-pressed', String(!grid));
  }
  function render() {
    const books = visibleBooks();
    const filtered = state.query || state.filter !== 'all';
    el.bookCount.textContent = filtered ? `${books.length} / ${state.books.length}` : String(books.length);
    el.statBooks.textContent = String(state.books.length);
    el.statReading.textContent = String(state.books.filter((book) => pct(state.progress[book.id]) > 0).length);
    el.empty.hidden = books.length > 0;
    el.resetFilters.hidden = !filtered || state.books.length === 0;
    if (!books.length) {
      el.emptyTitle.textContent = state.books.length ? '没有找到这样的书。' : '书架上还没有书。';
      el.emptyText.textContent = state.books.length ? '换个关键词，或者清除当前筛选。' : '在桌面端导入书籍之后，这里会自动出现。';
    }
    el.grid.textContent = '';
    state.cards.clear();
    renderLayout();
    const frag = document.createDocumentFragment();
    books.forEach((book, i) => {
      const entry = state.progress[book.id] || null;
      const percent = pct(entry);
      const card = document.createElement('button');
      card.className = 'card';
      card.type = 'button';
      card.style.animationDelay = `${Math.min(i, 14) * 24}ms`;
      card.dataset.bookId = book.id;
      card.setAttribute('aria-label', `打开《${book.name || '未命名'}》${entry ? `，已读 ${Math.round(percent)}%` : ''}`);
      const copy = document.createElement('div');
      copy.className = 'card-copy';
      copy.innerHTML = `<p class="card-title">${escapeHtml(book.name || '未命名')}</p><span class="card-sub">${escapeHtml(progressLabel(book, entry))}</span><div class="card-bar"><i style="width:${percent.toFixed(1)}%"></i></div>`;
      const percentNode = document.createElement('span');
      percentNode.className = 'card-percent';
      percentNode.textContent = entry ? `${Math.round(percent)}%` : '未读';
      card.append(coverNode(book, 'cover'), copy, percentNode);
      if (book.kind === 'cloud') {
        const badge = document.createElement('span');
        badge.className = 'card-badge';
        badge.textContent = '云端';
        card.querySelector('.cover').appendChild(badge);
      }
      card.addEventListener('click', () => openBook(book));
      frag.appendChild(card);
      state.cards.set(book.id, { card, bar: copy.querySelector('.card-bar i'), sub: copy.querySelector('.card-sub'), percent: percentNode });
    });
    el.grid.appendChild(frag);
    renderHero();
  }
  function renderHero() {
    let target = null;
    let best = -1;
    for (const book of state.books) {
      const at = Number(state.progress[book.id]?.updatedAt) || 0;
      if (at > best) { best = at; target = book; }
    }
    if (!target) target = state.books.find((book) => book.kind === 'local') || state.books[0] || null;
    if (!target) { el.hero.hidden = true; return; }
    const entry = state.progress[target.id] || null;
    const percent = pct(entry);
    el.hero.hidden = false;
    el.hero.textContent = '';
    const body = document.createElement('div');
    body.className = 'hero-body';
    body.innerHTML = `<div class="hero-kicker">${entry ? '继续阅读' : '从这里开始'}</div><h2 class="hero-title">${escapeHtml(target.name || '未命名')}</h2><div class="hero-sub">${escapeHtml(heroSub(target, entry))}</div><div class="hero-row"><button class="btn" type="button">${entry ? '接着读' : '打开书'}<svg><use href="#i-chevron"/></svg></button><div class="mini-bar"><i style="width:${percent.toFixed(1)}%"></i></div><span class="hero-percent">${Math.round(percent)}%</span></div>`;
    body.querySelector('.btn').addEventListener('click', () => openBook(target));
    el.hero.append(coverNode(target, 'hero-cover'), body);
  }
  function heroSub(book, entry) {
    if (!entry) return [book.author, book.kind === 'cloud' ? '云端书' : '本地书'].filter(Boolean).join(' · ') || '还没开始读';
    const bits = [];
    if (entry.chapterTitle) bits.push(entry.chapterTitle);
    bits.push(`读到 ${Math.round(pct(entry))}%`);
    if (entry.updatedAt) bits.push(agoText(entry.updatedAt));
    return bits.join(' · ');
  }

  /* 阅读公共部分 */
  function showReader() {
    el.shelfView.hidden = true;
    el.readerView.hidden = false;
    el.foot.hidden = true;
    document.body.classList.add('reading');
    el.readerView.classList.remove('chrome-hidden');
    closeToc();
    closePrefs();
  }
  function showShelf() {
    el.readerView.hidden = true;
    el.shelfView.hidden = false;
    el.foot.hidden = false;
    document.body.classList.remove('reading');
    el.remoteNotice.hidden = true;
    closeToc();
    closePrefs();
    document.title = 'Folio · 书架';
  }
  function readingHeader(book, title) {
    el.readerBook.textContent = book.name || '未命名';
    el.readerChapter.textContent = title || (state.mode === 'cloud' ? '正在获取目录…' : '全文');
    document.title = `${book.name || '未命名'} · Folio`;
  }
  function mountParagraphs(startIndex) {
    const frag = document.createDocumentFragment();
    state.paragraphs.forEach((item, index) => {
      const node = document.createElement('p');
      node.dataset.i = String(index);
      if (item.blank) { node.className = 'gap'; node.setAttribute('aria-hidden', 'true'); }
      else {
        node.textContent = item.text;
        if (state.localHeadings.has(index) || (state.mode === 'cloud' && index === 0 && item.text === state.chapterTitle)) node.className = 'chapter-heading';
      }
      frag.appendChild(node);
    });
    el.paper.textContent = '';
    el.paper.dataset.error = '0';
    el.paper.appendChild(frag);
    const start = Math.max(0, Math.min(Math.max(0, state.paragraphs.length - 1), Number(startIndex) || 0));
    requestAnimationFrame(() => {
      const node = el.paper.querySelector(`[data-i="${start}"]`);
      if (!node) { updateFoot(start); return; }
      node.scrollIntoView({ block: 'start' });
      requestAnimationFrame(() => {
        el.readerScroll.scrollTop = Math.max(0, node.offsetTop - 86);
        state.lastIndex = start;
        updateFoot(start);
      });
    });
  }
  function scrollToParagraph(index, options = {}) {
    const target = Math.max(0, Math.min(state.paragraphs.length - 1, Number(index) || 0));
    const node = el.paper.querySelector(`[data-i="${target}"]`);
    if (!node) return;
    state.leaving = false;
    node.scrollIntoView({ block: 'start', behavior: options.smooth ? 'smooth' : 'auto' });
    requestAnimationFrame(() => {
      el.readerScroll.scrollTop = Math.max(0, node.offsetTop - 86);
      state.lastIndex = target;
      if (state.mode === 'local') updateLocalChapter(target);
      updateFoot(target);
      if (options.save !== false) scheduleSave();
    });
  }
  function updateLocalChapter(index) {
    const chapter = localChapterForPara(index);
    if (chapter === state.chapter) return;
    state.chapter = chapter;
    state.chapterTitle = state.toc?.[chapter]?.title || '';
    if (state.current) readingHeader(state.current, state.chapterTitle || '全文');
    markTocCurrent(chapter);
    updateChapterButtons();
  }
  function updateChapterButtons() {
    const available = state.mode === 'cloud' || (state.toc?.length || 0) > 1;
    el.prevChapter.hidden = !available;
    el.nextChapter.hidden = !available;
    el.prevChapter.disabled = state.chapter <= 0;
    el.nextChapter.disabled = state.mode === 'cloud' ? (state.tocTotal > 0 && state.chapter >= state.tocTotal - 1) : state.chapter >= (state.toc?.length || 1) - 1;
  }
  function scheduleSave() {
    if (!state.allowWrite) { state.dirty = false; return; }
    state.dirty = true;
    clearTimeout(state.saveTimer);
    state.saveTimer = setTimeout(() => flushProgress(false), 1100);
  }

  /* 本地书 */
  async function openBook(book) {
    if (!book) return;
    if (book.kind === 'cloud') { openCloudBook(book); return; }
    setSync('saving', '正在加载正文');
    try {
      const res = await fetch(`/api/book/${encodeURIComponent(book.id)}`, { cache: 'no-store' });
      const payload = await res.json();
      if (!payload?.ok) { setSync('live', '已同步'); toast(payload?.error || '读不到这本书'); return; }
      const entry = state.progress[book.id] || null;
      state.readerSeq += 1;
      state.current = book;
      state.mode = 'local';
      state.paragraphs = splitParagraphs(payload.text || '');
      state.toc = buildLocalToc(state.paragraphs);
      state.tocTotal = state.toc.length;
      state.localHeadings = new Set(state.toc.filter((item) => item.paraIndex > 0 || item.title !== '开篇').map((item) => item.paraIndex));
      state.lastIndex = Math.max(0, Math.min(state.paragraphs.length - 1, Number(entry?.paraIndex) || 0));
      state.chapter = localChapterForPara(state.lastIndex);
      state.chapterTitle = state.toc[state.chapter]?.title || entry?.chapterTitle || '';
      state.leaving = false;
      state.dirty = false;
      state.remoteEntry = null;
      readingHeader(book, state.chapterTitle || '全文');
      updateChapterButtons();
      showReader();
      mountParagraphs(state.lastIndex);
      setSync('live', '已同步');
      history.pushState({ reader: book.id }, '', `#${encodeURIComponent(book.id)}`);
      if (!state.allowWrite) toast('只读模式：可以看，不记录进度');
    } catch {
      setSync('off', '连接中断，正文没取到');
      toast('加载失败，检查一下网络');
    }
  }

  /* 云端书 */
  async function openCloudBook(book) {
    const entry = state.progress[book.id] || {};
    const startChapter = Math.max(0, Number(entry.chapter ?? entry.windowBase) || 0);
    state.readerSeq += 1;
    state.current = book;
    state.mode = 'cloud';
    state.toc = null;
    state.tocTotal = 0;
    state.chapter = startChapter;
    state.chapterTitle = String(entry.chapterTitle || '');
    state.paragraphs = [];
    state.localHeadings = new Set();
    state.lastIndex = Math.max(0, Number(entry.paraIndex) || 0);
    state.leaving = false;
    state.dirty = false;
    state.chapterLoading = false;
    state.remoteEntry = null;
    readingHeader(book, state.chapterTitle || '正在获取目录…');
    updateChapterButtons();
    el.nextChapter.disabled = false;
    el.paper.textContent = '';
    el.paper.dataset.error = '0';
    updateProgressUI(0);
    showReader();
    history.pushState({ reader: book.id }, '', `#${encodeURIComponent(book.id)}`);
    if (!state.allowWrite) toast('只读模式：可以看，不记录进度');
    loadToc(book);
    loadChapter(startChapter, { resumeAt: state.lastIndex });
  }
  async function loadToc(book) {
    const seq = state.readerSeq;
    setSync('saving', '正在获取目录');
    try {
      const res = await fetch(`/api/toc/${encodeURIComponent(book.id)}`, { cache: 'no-store' });
      const payload = await res.json();
      if (state.current?.id !== book.id || seq !== state.readerSeq) return;
      if (!payload?.ok) { toast(payload?.error || '目录没取到，只能一章一章翻'); setSync('live', '已同步'); return; }
      state.toc = Array.isArray(payload.chapters) ? payload.chapters : [];
      state.tocTotal = Number(payload.total) || state.toc.length;
      const title = state.toc[state.chapter]?.title;
      if (title) { state.chapterTitle = title; readingHeader(book, title); }
      updateChapterButtons();
      renderToc();
      updateFoot(state.lastIndex);
      setSync('live', '已同步');
    } catch {
      if (state.current?.id !== book.id || seq !== state.readerSeq) return;
      setSync('off', '目录没取到，正在等待重连');
      toast('目录没取到，检查一下网络');
    }
  }
  async function loadChapter(index, options = {}) {
    const book = state.current;
    if (!book || state.mode !== 'cloud' || state.chapterLoading) return;
    const seq = state.readerSeq;
    state.chapterLoading = true;
    state.chapter = index;
    markTocCurrent(index);
    if (state.toc?.[index]?.title) state.chapterTitle = state.toc[index].title;
    readingHeader(book, state.chapterTitle || `第 ${index + 1} 章`);
    updateChapterButtons();
    el.readerScroll.scrollTop = 0;
    el.paper.textContent = '';
    el.paper.dataset.error = '0';
    el.paper.dataset.loading = '1';
    setSync('saving', '正在取正文');
    try {
      const res = await fetch(`/api/chapter/${encodeURIComponent(book.id)}?i=${index}`, { cache: 'no-store' });
      const payload = await res.json();
      if (state.current?.id !== book.id || state.mode !== 'cloud' || seq !== state.readerSeq) return;
      if (!payload?.ok) throw new Error(payload?.error || '这一章没有正文');
      state.paragraphs = splitParagraphs(payload.text || '');
      let start = Number(options.resumeAt) || 0;
      if (Number.isFinite(options.resumeRatio)) start = Math.round(options.resumeRatio * Math.max(0, state.paragraphs.length - 1));
      state.lastIndex = Math.max(0, Math.min(state.paragraphs.length - 1, start));
      state.leaving = false;
      state.dirty = false;
      mountParagraphs(state.lastIndex);
      updateFoot(state.lastIndex);
      setSync('live', '已同步');
      scheduleSave();
    } catch (err) {
      if (state.current?.id !== book.id || state.mode !== 'cloud' || seq !== state.readerSeq) return;
      state.paragraphs = [];
      state.dirty = false;
      el.paper.textContent = '';
      const node = document.createElement('p');
      node.className = 'reader-error';
      node.textContent = `${err?.message || '这一章没取到'}\n\n检查网络后，可以点下一章再回来重试。`;
      el.paper.appendChild(node);
      el.paper.dataset.error = '1';
      setSync('off', '没取到正文');
    } finally {
      if (seq === state.readerSeq) { state.chapterLoading = false; el.paper.dataset.loading = '0'; }
    }
  }
  function openChapter(index, options = {}) {
    if (!state.current) return;
    if (state.mode === 'local') {
      const item = state.toc?.[index];
      if (!item) return;
      state.chapter = index;
      state.chapterTitle = item.title;
      readingHeader(state.current, item.title);
      markTocCurrent(index);
      updateChapterButtons();
      scrollToParagraph(item.paraIndex);
      return;
    }
    if (index < 0 || (state.tocTotal && index >= state.tocTotal)) return;
    if (index === state.chapter && state.paragraphs.length && !Number.isFinite(options.resumeRatio) && options.resumeAt == null) {
      el.readerScroll.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }
    if (state.dirty && state.paragraphs.length) flushProgress(true);
    loadChapter(index, options);
  }

  /* 目录与设置抽屉 */
  function markTocCurrent(index) {
    el.tocList.querySelector('.toc-row.current')?.classList.remove('current');
    el.tocList.querySelector(`.toc-row[data-i="${index}"]`)?.classList.add('current');
  }
  function renderToc() {
    if (!state.toc) return;
    const query = el.tocSearch.value.trim().toLocaleLowerCase('zh-CN');
    const frag = document.createDocumentFragment();
    let matches = 0;
    state.toc.forEach((item, index) => {
      const title = item.title || `第 ${index + 1} 章`;
      if (query && !title.toLocaleLowerCase('zh-CN').includes(query)) return;
      matches += 1;
      const row = document.createElement('button');
      row.type = 'button';
      row.className = `toc-row${index === state.chapter ? ' current' : ''}`;
      row.dataset.i = String(index);
      const num = document.createElement('span');
      num.className = 'toc-num';
      num.textContent = String(index + 1);
      const name = document.createElement('span');
      name.className = 'toc-name';
      name.textContent = title;
      row.append(num, name);
      if (index === state.chapter) {
        const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        icon.innerHTML = '<use href="#i-location"/>';
        row.appendChild(icon);
      }
      row.addEventListener('click', () => { closeToc(); openChapter(index); });
      frag.appendChild(row);
    });
    el.tocList.textContent = '';
    el.tocList.appendChild(frag);
    el.tocEmpty.hidden = matches > 0;
    el.tocCount.textContent = query ? ` · ${matches} / ${state.toc.length}` : ` · ${state.toc.length} 章`;
  }
  function locateTocCurrent() {
    el.tocSearch.value = '';
    renderToc();
    requestAnimationFrame(() => {
      const row = el.tocList.querySelector('.toc-row.current');
      if (!row) return;
      const listRect = el.tocList.getBoundingClientRect();
      const rowRect = row.getBoundingClientRect();
      el.tocList.scrollTop = Math.max(0, el.tocList.scrollTop + rowRect.top - listRect.top - el.tocList.clientHeight / 2 + rowRect.height / 2);
    });
  }
  function openToc() {
    if (!state.current) return;
    if (!state.toc?.length) { toast(state.mode === 'cloud' ? '目录还在加载，稍等一下' : '这本书没有识别到章节'); return; }
    state.tocReturnFocus = document.activeElement;
    el.tocSearch.value = '';
    renderToc();
    el.tocSheet.hidden = false;
    document.body.classList.add('sheet-open');
    locateTocCurrent();
    setTimeout(() => el.tocSearch.focus({ preventScroll: true }), 80);
  }
  function closeToc() {
    if (el.tocSheet.hidden) return;
    el.tocSheet.hidden = true;
    document.body.classList.remove('sheet-open');
    state.tocReturnFocus?.focus?.({ preventScroll: true });
  }
  function openPrefs() {
    state.prefsReturnFocus = document.activeElement;
    renderPrefs();
    el.prefsSheet.hidden = false;
    document.body.classList.add('sheet-open');
    setTimeout(() => el.prefsClose.focus({ preventScroll: true }), 80);
  }
  function closePrefs() {
    if (el.prefsSheet.hidden) return;
    el.prefsSheet.hidden = true;
    document.body.classList.remove('sheet-open');
    state.prefsReturnFocus?.focus?.({ preventScroll: true });
  }

  function closeReader() {
    if (!state.current) return;
    flushProgress(true);
    state.readerSeq += 1;
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
    state.remoteEntry = null;
    el.paper.textContent = '';
    el.paper.dataset.loading = '0';
    el.readerScroll.scrollTop = 0;
    showShelf();
    history.replaceState(null, '', location.pathname + location.search);
    render();
  }

  /* 进度定位、拖动与保存 */
  function currentIndex() {
    const rect = el.readerScroll.getBoundingClientRect();
    const x = Math.round(rect.left + rect.width / 2);
    const y = Math.round(rect.top + Math.min(92, rect.height / 3));
    const hits = document.elementsFromPoint ? document.elementsFromPoint(x, y) : [document.elementFromPoint(x, y)];
    for (const node of hits) {
      const hit = node?.closest?.('[data-i]');
      if (hit && el.paper.contains(hit)) return Number(hit.dataset.i) || 0;
    }
    const items = el.paper.children;
    let lo = 0, hi = items.length - 1, ans = 0;
    const paperTop = el.paper.getBoundingClientRect().top + el.readerScroll.scrollTop;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const top = items[mid].getBoundingClientRect().top + el.readerScroll.scrollTop - paperTop;
      if (top + items[mid].offsetHeight > el.readerScroll.scrollTop + 4) { ans = mid; hi = mid - 1; }
      else lo = mid + 1;
    }
    return ans;
  }
  function updateProgressUI(percent) {
    const safe = Math.max(0, Math.min(100, Number(percent) || 0));
    el.readerPct.textContent = `${safe > 0 && safe < 1 ? '<1' : Math.round(safe)}%`;
    if (!state.scrubbing) el.progressRange.value = String(Math.round(safe * 10));
    el.progressRange.style.setProperty('--range-pct', `${safe}%`);
    el.progressRange.setAttribute('aria-valuetext', `已读 ${safe.toFixed(1)}%`);
    return safe;
  }
  function updateFoot(index) {
    const total = state.paragraphs.length || 1;
    const inner = Math.max(0, Math.min(1, (Number(index) || 0) / total));
    const percent = state.mode === 'cloud' && state.tocTotal > 0 ? Math.min(100, ((state.chapter + inner) / state.tocTotal) * 100) : inner * 100;
    return updateProgressUI(percent);
  }
  function onScroll() {
    if (!state.current || state.leaving || state.resizing || !state.paragraphs.length || state.scrubbing) return;
    const index = currentIndex();
    state.lastIndex = index;
    if (state.mode === 'local') updateLocalChapter(index);
    updateFoot(index);
    scheduleSave();
  }
  function seekToPercent(percent) {
    if (!state.current || !state.paragraphs.length) return;
    if (state.mode === 'local') {
      scrollToParagraph(Math.round((percent / 100) * Math.max(0, state.paragraphs.length - 1)));
      return;
    }
    if (!state.tocTotal) { toast('目录还没加载完，暂时不能跳转'); updateFoot(state.lastIndex); return; }
    const position = Math.min(state.tocTotal - .0001, Math.max(0, (percent / 100) * state.tocTotal));
    const chapter = Math.floor(position);
    const ratio = position - chapter;
    if (chapter === state.chapter) scrollToParagraph(Math.round(ratio * Math.max(0, state.paragraphs.length - 1)));
    else openChapter(chapter, { resumeRatio: ratio });
  }
  async function flushProgress(immediate) {
    if (!state.current || !state.dirty || !state.paragraphs.length || !state.allowWrite) return;
    if (state.saving) { state.dirty = true; return; }
    const book = state.current;
    const index = state.lastIndex || currentIndex();
    const percent = updateFoot(index);
    const data = state.mode === 'cloud'
      ? { chapter: state.chapter, chapterTitle: state.chapterTitle || '', windowBase: state.chapter, paraIndex: index, percent, updatedAt: Date.now() }
      : { paraIndex: index, chapterTitle: state.chapterTitle || '', percent, updatedAt: Date.now() };
    state.dirty = false;
    setSync('saving', '正在同步');
    const body = JSON.stringify({ id: book.id, data });
    if (immediate && navigator.sendBeacon) {
      try {
        if (navigator.sendBeacon('/api/progress', new Blob([body], { type: 'application/json' }))) {
          el.footState.textContent = '已提交';
          el.footState.dataset.show = '1';
          return;
        }
      } catch { /* 退化为 keepalive fetch */ }
    }
    state.saving = true;
    try {
      const res = await fetch('/api/progress', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, keepalive: true });
      const payload = await res.json();
      if (!res.ok) throw new Error(payload?.error || '进度没存上');
      if (payload.entry) { state.progress[book.id] = payload.entry; patchCard(book.id); }
      setSync('live', '已同步');
      el.footState.textContent = payload.applied ? '已同步' : '桌面端更新更晚';
      el.footState.dataset.show = '1';
      setTimeout(() => { el.footState.dataset.show = '0'; }, 1800);
    } catch (err) {
      state.dirty = true;
      setSync('off', err?.message || '连不上桌面端');
      showOffline('有一处阅读进度还没同步');
    } finally {
      state.saving = false;
      if (state.dirty && !immediate) scheduleSave();
    }
  }
  function patchCard(id) {
    const ref = state.cards.get(id);
    if (!ref) return;
    const entry = state.progress[id] || null;
    const book = state.books.find((item) => item.id === id);
    ref.bar.style.width = `${pct(entry).toFixed(1)}%`;
    if (book) ref.sub.textContent = progressLabel(book, entry);
    ref.percent.textContent = entry ? `${Math.round(pct(entry))}%` : '未读';
  }

  /* 加载与 SSE */
  async function load(silent) {
    if (!silent) setSync('saving', '正在读取');
    try {
      const res = await fetch('/api/state', { cache: 'no-store' });
      if (res.status === 401) { location.reload(); return false; }
      const data = await res.json();
      if (!data?.ok) throw new Error(data?.error || 'bad state');
      state.books = Array.isArray(data.books) ? data.books : [];
      state.progress = data.progress && typeof data.progress === 'object' ? data.progress : {};
      state.theme = data.theme || { id: 'paper' };
      state.server = data.server || {};
      state.allowWrite = data.server?.allowWrite !== false;
      el.readOnlyNote.hidden = state.allowWrite;
      applyTheme();
      el.foot.textContent = `Folio ${state.server.version || ''} · 同一间书房，在每一块屏幕上继续`;
      render();
      setSync('live', '已同步');
      return true;
    } catch {
      setSync('off', '连不上桌面端');
      if (!silent) toast('读不到数据，确认桌面端还开着');
      return false;
    }
  }
  function connectStream() {
    if (!window.EventSource) return;
    state.stream?.close();
    const stream = new EventSource('/api/events');
    state.stream = stream;
    stream.addEventListener('open', () => setSync('live', '已同步'));
    const config = (event, notify) => {
      try {
        const data = JSON.parse(event.data);
        state.allowWrite = data.allowWrite !== false;
        el.readOnlyNote.hidden = state.allowWrite;
        if (notify) toast(state.allowWrite ? '桌面端允许写入进度了' : '桌面端改成只读了');
      } catch { /* ignore */ }
    };
    stream.addEventListener('hello', (event) => config(event, false));
    stream.addEventListener('config', (event) => config(event, true));
    stream.addEventListener('progress', (event) => {
      let data;
      try { data = JSON.parse(event.data); } catch { return; }
      if (!data?.progress || typeof data.progress !== 'object') return;
      const currentId = state.current?.id || null;
      const before = currentId ? state.progress[currentId] : null;
      state.progress = data.progress;
      for (const id of state.cards.keys()) patchCard(id);
      renderHeroIfIdle();
      if (data.origin === 'remote') return;
      const entry = currentId ? state.progress[currentId] : null;
      if (entry && Date.now() - state.hintAt > 6000 && Math.abs(pct(entry) - pct(before)) > .5) {
        state.hintAt = Date.now();
        state.remoteEntry = entry;
        el.remoteText.textContent = `桌面端读到 ${Math.round(pct(entry))}%${entry.chapterTitle ? ` · ${entry.chapterTitle}` : ''}`;
        el.remoteNotice.hidden = false;
      }
    });
    stream.addEventListener('error', () => setSync('off', '连接断开，正在重连'));
  }
  let heroRaf = 0;
  function renderHeroIfIdle() {
    if (state.current) return;
    cancelAnimationFrame(heroRaf);
    heroRaf = requestAnimationFrame(renderHero);
  }
  function goToRemotePosition() {
    const entry = state.remoteEntry;
    if (!entry || !state.current) return;
    el.remoteNotice.hidden = true;
    if (state.mode === 'cloud') openChapter(Math.max(0, Number(entry.chapter ?? entry.windowBase) || 0), { resumeAt: Math.max(0, Number(entry.paraIndex) || 0) });
    else scrollToParagraph(Number(entry.paraIndex) || 0);
    toast('已来到桌面端的位置');
  }

  /* 事件 */
  el.refresh.addEventListener('click', async () => { if (await load(false)) toast('书架已刷新'); });
  el.syncStatus.addEventListener('click', () => { load(true); if (state.dirty) flushProgress(false); });
  el.retryConnection.addEventListener('click', async () => { if (await load(false) && state.dirty) flushProgress(false); });
  el.bookSearch.addEventListener('input', () => { state.query = el.bookSearch.value; render(); });
  el.bookSort.addEventListener('change', () => { setPreference('sort', el.bookSort.value); render(); });
  el.bookFilters.addEventListener('click', (event) => {
    const button = event.target.closest('button[data-filter]');
    if (!button) return;
    state.filter = button.dataset.filter;
    for (const item of el.bookFilters.querySelectorAll('button')) {
      const active = item === button;
      item.classList.toggle('active', active);
      item.setAttribute('aria-pressed', String(active));
    }
    render();
  });
  el.resetFilters.addEventListener('click', () => {
    state.filter = 'all'; state.query = ''; el.bookSearch.value = '';
    el.bookFilters.querySelector('[data-filter="all"]').click();
  });
  el.gridLayout.addEventListener('click', () => { setPreference('layout', 'grid'); renderLayout(); });
  el.listLayout.addEventListener('click', () => { setPreference('layout', 'list'); renderLayout(); });
  el.backToShelf.addEventListener('click', closeReader);
  el.appearance.addEventListener('click', openPrefs);
  el.readerSettings.addEventListener('click', openPrefs);
  el.prefsClose.addEventListener('click', closePrefs);
  el.prefsSheet.addEventListener('click', (event) => { if (event.target === el.prefsSheet) closePrefs(); });
  el.fontUp.addEventListener('click', () => setReadingSize(state.prefs.size + 1));
  el.fontDown.addEventListener('click', () => setReadingSize(state.prefs.size - 1));
  el.fontSize.addEventListener('input', () => setReadingSize(Number(el.fontSize.value)));
  el.themeChoices.addEventListener('click', (event) => { const b = event.target.closest('[data-theme-choice]'); if (b) setPreference('theme', b.dataset.themeChoice); });
  el.leadingChoices.addEventListener('click', (event) => { const b = event.target.closest('[data-leading]'); if (b) setPreference('leading', Number(b.dataset.leading)); });
  el.fontChoices.addEventListener('click', (event) => { const b = event.target.closest('[data-font]'); if (b) setPreference('font', b.dataset.font); });
  el.measureChoices.addEventListener('click', (event) => { const b = event.target.closest('[data-measure]'); if (b) setPreference('measure', b.dataset.measure); });
  el.readerScroll.addEventListener('scroll', onScroll, { passive: true });
  el.readerChapter.parentElement.addEventListener('click', openToc);
  el.openToc.addEventListener('click', openToc);
  el.prevChapter.addEventListener('click', () => openChapter(state.chapter - 1));
  el.nextChapter.addEventListener('click', () => openChapter(state.chapter + 1));
  el.tocClose.addEventListener('click', closeToc);
  el.tocSheet.addEventListener('click', (event) => { if (event.target === el.tocSheet) closeToc(); });
  el.tocSearch.addEventListener('input', renderToc);
  el.tocLocate.addEventListener('click', locateTocCurrent);
  el.goRemote.addEventListener('click', goToRemotePosition);
  el.dismissRemote.addEventListener('click', () => { el.remoteNotice.hidden = true; state.remoteEntry = null; });
  el.progressRange.addEventListener('input', () => { state.scrubbing = true; updateProgressUI(Number(el.progressRange.value) / 10); });
  el.progressRange.addEventListener('change', () => { const percent = Number(el.progressRange.value) / 10; state.scrubbing = false; seekToPercent(percent); });
  el.paper.addEventListener('click', () => {
    if (!state.current || !window.getSelection()?.isCollapsed) return;
    el.readerView.classList.toggle('chrome-hidden');
    el.remoteNotice.hidden = true;
  });
  el.readerScroll.addEventListener('touchstart', (event) => {
    const touch = event.changedTouches[0];
    state.gesture = { x: touch.clientX, y: touch.clientY, at: Date.now() };
  }, { passive: true });
  el.readerScroll.addEventListener('touchend', (event) => {
    if (!state.gesture || !state.current || (state.mode === 'local' && (state.toc?.length || 0) < 2)) return;
    const touch = event.changedTouches[0];
    const gesture = state.gesture;
    const dx = touch.clientX - gesture.x;
    const dy = touch.clientY - gesture.y;
    state.gesture = null;
    if (Date.now() - gesture.at > 700 || Math.abs(dx) < 72 || Math.abs(dy) > 45) return;
    if (dx < 0 && !el.nextChapter.disabled) openChapter(state.chapter + 1);
    else if (dx > 0 && !el.prevChapter.disabled) openChapter(state.chapter - 1);
  }, { passive: true });

  document.addEventListener('keydown', (event) => {
    const editing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName || '');
    if (event.key === 'Escape') {
      if (!el.prefsSheet.hidden) { closePrefs(); return; }
      if (!el.tocSheet.hidden) { closeToc(); return; }
      if (state.current) closeReader();
      return;
    }
    if (event.key === '/' && !state.current && !editing) { event.preventDefault(); el.bookSearch.focus(); return; }
    if (state.current && !editing && el.tocSheet.hidden && el.prefsSheet.hidden) {
      if (event.key === 'ArrowRight' && !el.nextChapter.disabled) openChapter(state.chapter + 1);
      if (event.key === 'ArrowLeft' && !el.prevChapter.disabled) openChapter(state.chapter - 1);
    }
  });
  window.addEventListener('popstate', () => { if (state.current) closeReader(); });
  const markLeaving = () => {
    if (!state.current) return;
    state.leaving = true;
    clearTimeout(state.saveTimer);
    if (state.dirty) flushProgress(true);
  };
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') markLeaving();
    else { state.leaving = false; if (state.dirty) scheduleSave(); }
  });
  window.addEventListener('pagehide', markLeaving);
  window.addEventListener('offline', () => setSync('off', '设备已离线，进度会在恢复后同步'));
  window.addEventListener('online', () => { load(true); if (state.dirty) flushProgress(false); });
  window.addEventListener('resize', () => {
    if (!state.current || !state.paragraphs.length) return;
    // 旋转手机 / 改变视口会引发一连串非用户滚动。钉住当前段落，等布局稳定再恢复。
    state.resizing = true;
    const index = state.lastIndex;
    clearTimeout(state.resizeTimer);
    state.resizeTimer = setTimeout(() => {
      const node = el.paper.querySelector(`[data-i="${index}"]`);
      if (node) el.readerScroll.scrollTop = Math.max(0, node.offsetTop - 86);
      updateFoot(index);
      requestAnimationFrame(() => { state.resizing = false; });
    }, 180);
  });
  window.addEventListener('scroll', () => el.topbar.classList.toggle('scrolled', window.scrollY > 4), { passive: true });

  /* 启动 */
  applyPrefs();
  el.bookSort.value = state.prefs.sort;
  load(false).then((ok) => {
    connectStream();
    if (!ok) return;
    const hash = location.hash.replace(/^#/, '');
    if (hash) {
      let id = hash;
      try { id = decodeURIComponent(hash); } catch { /* 保留原字符串 */ }
      const book = state.books.find((item) => item.id === id);
      if (book) openBook(book);
    }
  });
})();
