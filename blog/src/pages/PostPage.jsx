import { useEffect, useMemo, useState } from 'react';
import { motion } from 'motion/react';
import { api } from '../lib/api.js';
import { renderMarkdown } from '../lib/markdown.js';
import { formatDate } from '../lib/format.js';
import { Link } from '../lib/router.jsx';

export default function PostPage({ slug, site }) {
  const [post, setPost] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let alive = true;
    setPost(null);
    setError(null);
    api(`/api/posts/${encodeURIComponent(slug)}`)
      .then((data) => {
        if (alive) setPost(data);
      })
      .catch((err) => {
        if (alive) setError(err.status === 404 ? '这篇文章不存在，或者已经被收回了。' : err.message);
      });
    return () => {
      alive = false;
    };
  }, [slug]);

  useEffect(() => {
    if (post) document.title = `${post.title} · ${site?.title || '纸间'}`;
  }, [post, site]);

  const html = useMemo(() => renderMarkdown(post?.content || ''), [post?.content]);

  if (error) {
    return (
      <main className="post-page">
        <div className="post-missing">
          <span className="post-missing__code">404</span>
          <p>{error}</p>
          <Link href="/" className="btn btn--primary">
            回到文章列表
          </Link>
        </div>
      </main>
    );
  }

  if (!post) {
    return (
      <main className="post-page">
        <div className="post-page__inner">
          <div className="skeleton skeleton--line" style={{ width: '30%' }} />
          <div className="skeleton skeleton--banner" />
          <div className="skeleton skeleton--title" />
          <div className="skeleton skeleton--line" />
          <div className="skeleton skeleton--line" style={{ width: '88%' }} />
          <div className="skeleton skeleton--line" style={{ width: '76%' }} />
        </div>
      </main>
    );
  }

  const glyph = Array.from(post.title || '文')[0];

  return (
    <main className="post-page">
      <div className="post-page__inner">
        <Link href="/" className="back-link">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.8">
            <path d="M19 12H5M11 18l-6-6 6-6" />
          </svg>
          所有文章
        </Link>

        <motion.div
          className={`post-banner accent-${post.accent}`}
          initial={{ opacity: 0, scale: 0.98 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
        >
          {post.cover ? <img src={post.cover} alt="" /> : <span className="post-banner__glyph">{glyph}</span>}
          <span className="post-banner__label">NOTE · {formatDate(post.publishedAt || post.createdAt)}</span>
        </motion.div>

        <header className="post-head">
          <motion.div
            className="post-head__tags"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
          >
            {(post.tags || []).map((tag) => (
              <span key={tag} className="tag">
                {tag}
              </span>
            ))}
          </motion.div>

          <motion.h1
            className="post-head__title"
            initial={{ opacity: 0, y: 18 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.14, duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
          >
            {post.title}
          </motion.h1>

          {post.excerpt && <p className="post-head__excerpt">{post.excerpt}</p>}

          <div className="post-head__meta">
            <span>{formatDate(post.publishedAt || post.createdAt)}</span>
            <span className="post-card__dot" />
            <span>{post.readingMinutes || 3} 分钟阅读</span>
            {site?.author && (
              <>
                <span className="post-card__dot" />
                <span>{site.author}</span>
              </>
            )}
          </div>
        </header>

        <article className="prose" dangerouslySetInnerHTML={{ __html: html }} />

        <footer className="post-end">
          <span className="post-end__mark">完</span>
          <div className="post-end__actions">
            <button type="button" className="btn btn--ghost" onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}>
              回到顶部
            </button>
            <Link href="/" className="btn btn--primary">
              继续阅读
            </Link>
          </div>
        </footer>
      </div>
    </main>
  );
}
