import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { api } from '../lib/api.js';
import { renderMarkdown, countChars } from '../lib/markdown.js';
import { formatDate, relativeTime } from '../lib/format.js';
import { navigate } from '../lib/router.jsx';

const emptyDraft = () => ({
  id: null,
  title: '',
  slug: '',
  excerpt: '',
  content: '',
  tagsText: '',
  cover: '',
  accent: 'ember',
  status: 'draft',
});

function toDraft(post) {
  return {
    id: post.id,
    title: post.title || '',
    slug: post.slug || '',
    excerpt: post.excerpt || '',
    content: post.content || '',
    tagsText: (post.tags || []).join(', '),
    cover: post.cover || '',
    accent: post.accent || 'ember',
    status: post.status || 'draft',
  };
}

function toPayload(draft, status) {
  return {
    title: draft.title,
    slug: draft.slug,
    excerpt: draft.excerpt,
    content: draft.content,
    cover: draft.cover || null,
    accent: draft.accent,
    status: status || draft.status,
    tags: draft.tagsText
      .split(/[,，]/)
      .map((tag) => tag.trim())
      .filter(Boolean),
  };
}

export default function AdminPage({ site, onSiteChange }) {
  const [auth, setAuth] = useState('checking');
  const [posts, setPosts] = useState([]);
  const [view, setView] = useState('list');
  const [draft, setDraft] = useState(null);
  const [snapshot, setSnapshot] = useState('');
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState(null);
  const toastTimer = useRef(null);

  const notify = useCallback((message) => {
    setToast(message);
    window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 2400);
  }, []);

  useEffect(() => {
    document.title = '写作台 · 纸间';
    return () => window.clearTimeout(toastTimer.current);
  }, []);

  useEffect(() => {
    api('/api/admin/me')
      .then(() => setAuth('in'))
      .catch(() => setAuth('out'));
  }, []);

  useEffect(() => {
    if (auth !== 'in') return;
    api('/api/admin/posts')
      .then(setPosts)
      .catch((error) => notify(error.message));
  }, [auth, notify]);

  const startEditing = useCallback((nextDraft, savedPost) => {
    setDraft(nextDraft);
    setSnapshot(JSON.stringify(nextDraft));
    setView('editor');
    if (savedPost) {
      setPosts((prev) => {
        const rest = prev.filter((item) => item.id !== savedPost.id);
        return [{ ...savedPost, content: undefined }, ...rest];
      });
    }
  }, []);

  const openNew = () => startEditing(emptyDraft());

  const openEdit = async (id) => {
    try {
      const post = await api(`/api/admin/posts/${id}`);
      startEditing(toDraft(post), post);
    } catch (error) {
      notify(error.message);
    }
  };

  const saveDraft = async (status) => {
    if (!draft || saving) return;
    setSaving(true);
    const payload = toPayload(draft, status);
    try {
      const result = draft.id
        ? await api(`/api/admin/posts/${draft.id}`, { method: 'PUT', body: payload })
        : await api('/api/admin/posts', { method: 'POST', body: payload });
      const next = toDraft(result);
      setDraft(next);
      setSnapshot(JSON.stringify(next));
      setPosts((prev) => {
        const rest = prev.filter((item) => item.id !== result.id);
        return [{ ...result, content: undefined }, ...rest];
      });
      notify(result.status === 'published' ? '已发布，前台立刻可见' : '草稿已保存');
    } catch (error) {
      notify(error.message);
    } finally {
      setSaving(false);
    }
  };

  const removePost = async (id) => {
    try {
      await api(`/api/admin/posts/${id}`, { method: 'DELETE' });
      setPosts((prev) => prev.filter((item) => item.id !== id));
      if (draft?.id === id) {
        setDraft(null);
        setView('list');
      }
      notify('文章已删除');
    } catch (error) {
      notify(error.message);
    }
  };

  const logout = async () => {
    await api('/api/admin/logout', { method: 'POST' }).catch(() => {});
    navigate('/');
  };

  const dirty = Boolean(draft && JSON.stringify(draft) !== snapshot);

  useEffect(() => {
    if (view !== 'editor' || !draft) return;
    const onKey = (event) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
        event.preventDefault();
        saveDraft(draft.status);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [view, draft]);

  if (auth === 'checking') {
    return (
      <main className="admin">
        <div className="admin__loading">
          <span className="spinner" />
        </div>
      </main>
    );
  }

  if (auth === 'out') {
    return <LoginScreen onSuccess={() => setAuth('in')} />;
  }

  return (
    <main className="admin">
      {view === 'editor' && (
        <Editor
          draft={draft}
          dirty={dirty}
          saving={saving}
          onChange={(patch) => setDraft((current) => ({ ...current, ...patch }))}
          onSave={saveDraft}
          onBack={() => setView('list')}
          notify={notify}
        />
      )}

      {view === 'settings' && (
        <Settings
          site={site}
          onBack={() => setView('list')}
          onSaved={(next) => {
            onSiteChange?.(next);
            notify('站点信息已更新');
          }}
          notify={notify}
        />
      )}

      {(view === 'list') && (
        <Dashboard
          posts={posts}
          onNew={openNew}
          onEdit={openEdit}
          onDelete={removePost}
          onSettings={() => setView('settings')}
          onLogout={logout}
        />
      )}

      <Toast message={toast} />
    </main>
  );
}

/* ------------------------------- 登录 ------------------------------- */

function LoginScreen({ onSuccess }) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [shake, setShake] = useState(0);

  const submit = async (event) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await api('/api/admin/login', { method: 'POST', body: { password } });
      onSuccess();
    } catch (err) {
      setError(err.message);
      setShake((value) => value + 1);
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="admin admin--gate">
      <motion.form
        className="login"
        onSubmit={submit}
        initial={{ opacity: 0, y: 24 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
      >
        <span className="login__mark">纸</span>
        <h1>写作台</h1>
        <p className="login__hint">输入管理员口令，开始写字。</p>

        <motion.div key={shake} animate={shake ? { x: [0, -9, 9, -5, 5, 0] } : undefined} transition={{ duration: 0.42 }}>
          <input
            className="field field--lg"
            type="password"
            autoFocus
            autoComplete="current-password"
            placeholder="管理员口令"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </motion.div>

        <AnimatePresence>
          {error && (
            <motion.p
              className="login__error"
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
            >
              {error}
            </motion.p>
          )}
        </AnimatePresence>

        <button className="btn btn--primary btn--block" type="submit" disabled={busy || !password}>
          {busy ? '验证中…' : '进入写作台'}
        </button>

        <p className="login__foot">首次启动时，口令会打印在运行 API 的终端里。</p>
        <button type="button" className="login__back" onClick={() => navigate('/')}>
          ← 回首页
        </button>
      </motion.form>
    </main>
  );
}

/* ------------------------------- 列表 ------------------------------- */

function Dashboard({ posts, onNew, onEdit, onDelete, onSettings, onLogout }) {
  const [confirmId, setConfirmId] = useState(null);
  const published = posts.filter((post) => post.status === 'published').length;

  return (
    <div className="admin__shell">
      <header className="admin-bar">
        <div className="admin-bar__brand">
          <span className="admin-bar__mark">纸</span>
          写作台
        </div>
        <div className="admin-bar__actions">
          <button type="button" className="btn btn--ghost btn--sm" onClick={onSettings}>
            站点设置
          </button>
          <button type="button" className="btn btn--ghost btn--sm" onClick={onLogout}>
            退出
          </button>
        </div>
      </header>

      <div className="admin-body">
        <div className="admin-body__head">
          <div>
            <span className="section-kicker">POSTS</span>
            <h1>
              全部文章
              <span className="admin-count">
                {published} 已发布 / {posts.length} 篇
              </span>
            </h1>
          </div>
          <div className="admin-body__head-actions">
            <button type="button" className="btn btn--primary" onClick={onNew}>
              <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M12 5v14M5 12h14" />
              </svg>
              写新文章
            </button>
          </div>
        </div>

        {posts.length === 0 ? (
          <div className="admin-empty">
            <p>还没有文章。写下第一篇吧。</p>
            <button type="button" className="btn btn--primary" onClick={onNew}>
              开始写
            </button>
          </div>
        ) : (
          <ul className="admin-list">
            <AnimatePresence initial={false}>
              {posts.map((post) => (
                <motion.li
                  key={post.id}
                  className="admin-row"
                  layout
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, height: 0, marginBottom: 0 }}
                  transition={{ type: 'spring', stiffness: 260, damping: 28 }}
                >
                  <span className={`status-dot status-dot--${post.status}`} />
                  <button type="button" className="admin-row__main" onClick={() => onEdit(post.id)}>
                    <span className="admin-row__title">{post.title || '无标题'}</span>
                    <span className="admin-row__meta">
                      {post.status === 'published' ? '已发布' : '草稿'} · {relativeTime(post.updatedAt)} ·{' '}
                      {formatDate(post.updatedAt)}
                    </span>
                  </button>

                  <div className="admin-row__actions">
                    <button type="button" className="btn btn--ghost btn--sm" onClick={() => onEdit(post.id)}>
                      编辑
                    </button>
                    {confirmId === post.id ? (
                      <>
                        <button type="button" className="btn btn--danger btn--sm" onClick={() => onDelete(post.id)}>
                          确认删除
                        </button>
                        <button type="button" className="btn btn--ghost btn--sm" onClick={() => setConfirmId(null)}>
                          取消
                        </button>
                      </>
                    ) : (
                      <button type="button" className="btn btn--ghost btn--sm" onClick={() => setConfirmId(post.id)}>
                        删除
                      </button>
                    )}
                  </div>
                </motion.li>
              ))}
            </AnimatePresence>
          </ul>
        )}
      </div>
    </div>
  );
}

/* ------------------------------- 编辑器 ------------------------------- */

const ACCENTS = [
  { value: 'ember', label: '赭石' },
  { value: 'sage', label: '苔绿' },
  { value: 'ink', label: '墨蓝' },
  { value: 'sky', label: '雾青' },
];

function Editor({ draft, dirty, saving, onChange, onSave, onBack, notify }) {
  const textareaRef = useRef(null);
  const imageRef = useRef(null);
  const coverRef = useRef(null);
  const [panel, setPanel] = useState('write');
  const [uploading, setUploading] = useState(false);

  const preview = useMemo(() => renderMarkdown(draft.content), [draft.content]);
  const chars = countChars(draft.content);

  const insert = (before, after = '', placeholder = '文字') => {
    const element = textareaRef.current;
    const content = draft.content;
    const start = element ? element.selectionStart : content.length;
    const end = element ? element.selectionEnd : content.length;
    const selected = content.slice(start, end) || placeholder;
    const next = content.slice(0, start) + before + selected + after + content.slice(end);
    onChange({ content: next });
    requestAnimationFrame(() => {
      if (!element) return;
      element.focus();
      element.selectionStart = start + before.length;
      element.selectionEnd = start + before.length + selected.length;
    });
  };

  const insertBlock = (prefix, placeholder = '内容') => {
    const element = textareaRef.current;
    const content = draft.content;
    const start = element ? element.selectionStart : content.length;
    const end = element ? element.selectionEnd : content.length;
    const selected = content.slice(start, end) || placeholder;
    const block = `\n${prefix}${selected.replace(/\n/g, `\n${prefix}`)}\n`;
    const next = content.slice(0, start) + block + content.slice(end);
    onChange({ content: next });
    requestAnimationFrame(() => {
      if (!element) return;
      element.focus();
      element.selectionStart = start + block.length;
      element.selectionEnd = start + block.length;
    });
  };

  const readAsDataUrl = (file) =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(new Error('读取图片失败'));
      reader.readAsDataURL(file);
    });

  const uploadImage = async (file, mode) => {
    if (!file) return;
    if (!/^image\//.test(file.type)) return notify('只能上传图片');
    if (file.size > 8 * 1024 * 1024) return notify('图片不能超过 8MB');
    setUploading(true);
    try {
      const dataUrl = await readAsDataUrl(file);
      const result = await api('/api/admin/upload', { method: 'POST', body: { name: file.name, dataUrl } });
      if (mode === 'cover') {
        onChange({ cover: result.url });
        notify('封面已更新');
      } else {
        const alt = file.name.replace(/\.[^.]+$/, '');
        insert(`\n![${alt}](${result.url})\n`);
        notify('图片已插入');
      }
    } catch (error) {
      notify(error.message);
    } finally {
      setUploading(false);
    }
  };

  const handlePaste = (event) => {
    const file = [...(event.clipboardData?.files || [])].find((item) => item.type.startsWith('image/'));
    if (!file) return;
    event.preventDefault();
    uploadImage(file, 'insert');
  };

  return (
    <div className="editor">
      <header className="editor-bar">
        <button type="button" className="btn btn--ghost btn--sm" onClick={onBack}>
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.8">
            <path d="M19 12H5M11 18l-6-6 6-6" />
          </svg>
          文章
        </button>

        <div className="editor-bar__state">
          <span className={`status-pill status-pill--${draft.status}`}>
            {draft.status === 'published' ? '已发布' : '草稿'}
          </span>
          {dirty && <span className="editor-bar__dirty">未保存</span>}
        </div>

        <div className="editor-bar__actions">
          <span className="editor-bar__hint">Ctrl / ⌘ + S 保存</span>
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            disabled={saving}
            onClick={() => onSave(draft.status === 'published' ? 'published' : 'draft')}
          >
            {saving ? '保存中…' : '保存'}
          </button>
          <button type="button" className="btn btn--primary btn--sm" disabled={saving} onClick={() => onSave('published')}>
            发布
          </button>
        </div>
      </header>

      <div className="editor-fields">
        <input
          className="editor-title"
          placeholder="文章标题"
          value={draft.title}
          onChange={(event) => onChange({ title: event.target.value })}
        />

        <div className="editor-fields__row">
          <label className="editor-field">
            <span>链接 slug</span>
            <input
              className="field"
              placeholder="留空则按标题生成"
              value={draft.slug}
              onChange={(event) => onChange({ slug: event.target.value })}
            />
          </label>
          <label className="editor-field">
            <span>标签（逗号分隔）</span>
            <input
              className="field"
              placeholder="阅读, 随笔"
              value={draft.tagsText}
              onChange={(event) => onChange({ tagsText: event.target.value })}
            />
          </label>
          <label className="editor-field editor-field--accent">
            <span>封面色</span>
            <select className="field" value={draft.accent} onChange={(event) => onChange({ accent: event.target.value })}>
              {ACCENTS.map((accent) => (
                <option key={accent.value} value={accent.value}>
                  {accent.label}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="editor-fields__row">
          <label className="editor-field editor-field--grow">
            <span>摘要（留空自动截取）</span>
            <input
              className="field"
              placeholder="一两句话，出现在列表里"
              value={draft.excerpt}
              onChange={(event) => onChange({ excerpt: event.target.value })}
            />
          </label>
          <label className="editor-field editor-field--grow">
            <span>封面图 URL</span>
            <div className="editor-cover">
              <input
                className="field"
                placeholder="https://…"
                value={draft.cover}
                onChange={(event) => onChange({ cover: event.target.value })}
              />
              <button type="button" className="btn btn--ghost btn--sm" onClick={() => coverRef.current?.click()}>
                上传
              </button>
              {draft.cover && (
                <button type="button" className="btn btn--ghost btn--sm" onClick={() => onChange({ cover: '' })}>
                  移除
                </button>
              )}
            </div>
          </label>
        </div>
      </div>

      <div className="editor-toolbar">
        <div className="editor-toolbar__group">
          <button type="button" title="加粗" onClick={() => insert('**', '**')}>
            <strong>B</strong>
          </button>
          <button type="button" title="斜体" onClick={() => insert('*', '*')}>
            <em>I</em>
          </button>
          <button type="button" title="标题" onClick={() => insertBlock('## ', '小标题')}>
            H2
          </button>
          <button type="button" title="引用" onClick={() => insertBlock('> ', '引用')}>
            “
          </button>
          <button type="button" title="列表" onClick={() => insertBlock('- ', '列表项')}>
            ≡
          </button>
          <button type="button" title="代码块" onClick={() => insert('\n```\n', '\n```\n', 'code')}>
            {'</>'}
          </button>
          <button type="button" title="链接" onClick={() => insert('[', '](https://)', '链接文字')}>
            ↗
          </button>
          <button type="button" title="插入图片" onClick={() => imageRef.current?.click()} disabled={uploading}>
            {uploading ? '…' : '图片'}
          </button>
        </div>

        <div className="editor-toolbar__tabs">
          <button type="button" className={panel === 'write' ? 'is-active' : ''} onClick={() => setPanel('write')}>
            编辑
          </button>
          <button type="button" className={panel === 'preview' ? 'is-active' : ''} onClick={() => setPanel('preview')}>
            预览
          </button>
        </div>

        <span className="editor-toolbar__count">{chars} 字</span>
      </div>

      <div className="editor-split" data-panel={panel}>
        <textarea
          ref={textareaRef}
          className="editor-text"
          placeholder="开始写…  支持 Markdown，可以直接粘贴图片。"
          value={draft.content}
          spellCheck="false"
          onChange={(event) => onChange({ content: event.target.value })}
          onPaste={handlePaste}
        />
        <div className="editor-preview">
          <div className="editor-preview__head">预览</div>
          {draft.content.trim() ? (
            <article className="prose" dangerouslySetInnerHTML={{ __html: preview }} />
          ) : (
            <p className="editor-preview__empty">左边的文字会实时出现在这里。</p>
          )}
        </div>
      </div>

      <input
        ref={imageRef}
        type="file"
        accept="image/*"
        hidden
        onChange={(event) => {
          uploadImage(event.target.files?.[0], 'insert');
          event.target.value = '';
        }}
      />
      <input
        ref={coverRef}
        type="file"
        accept="image/*"
        hidden
        onChange={(event) => {
          uploadImage(event.target.files?.[0], 'cover');
          event.target.value = '';
        }}
      />
    </div>
  );
}

/* ------------------------------- 站点设置 ------------------------------- */

function Settings({ site, onBack, onSaved, notify }) {
  const [form, setForm] = useState(() => ({
    title: site?.title || '',
    subtitle: site?.subtitle || '',
    author: site?.author || '',
    tagline: site?.tagline || '',
  }));
  const [saving, setSaving] = useState(false);

  const save = async (event) => {
    event.preventDefault();
    setSaving(true);
    try {
      const next = await api('/api/admin/site', { method: 'PUT', body: form });
      onSaved(next);
    } catch (error) {
      notify(error.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="admin__shell">
      <header className="admin-bar">
        <button type="button" className="btn btn--ghost btn--sm" onClick={onBack}>
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.8">
            <path d="M19 12H5M11 18l-6-6 6-6" />
          </svg>
          返回
        </button>
        <span className="admin-bar__brand">站点设置</span>
        <span />
      </header>

      <form className="settings" onSubmit={save}>
        <label className="editor-field">
          <span>站点名称</span>
          <input
            className="field field--lg"
            value={form.title}
            onChange={(event) => setForm({ ...form, title: event.target.value })}
          />
        </label>
        <label className="editor-field">
          <span>副标题</span>
          <input
            className="field"
            value={form.subtitle}
            onChange={(event) => setForm({ ...form, subtitle: event.target.value })}
          />
        </label>
        <label className="editor-field">
          <span>作者署名</span>
          <input
            className="field"
            value={form.author}
            onChange={(event) => setForm({ ...form, author: event.target.value })}
          />
        </label>
        <label className="editor-field">
          <span>首页底部一句</span>
          <input
            className="field"
            value={form.tagline}
            onChange={(event) => setForm({ ...form, tagline: event.target.value })}
          />
        </label>
        <button type="submit" className="btn btn--primary" disabled={saving}>
          {saving ? '保存中…' : '保存设置'}
        </button>
      </form>
    </div>
  );
}

/* ------------------------------- 提示 ------------------------------- */

function Toast({ message }) {
  return (
    <AnimatePresence>
      {message && (
        <motion.div
          className="toast"
          initial={{ opacity: 0, y: 18, scale: 0.96 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 10, scale: 0.98 }}
          transition={{ type: 'spring', stiffness: 320, damping: 26 }}
        >
          {message}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
