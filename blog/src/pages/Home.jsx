import { useEffect, useMemo, useState } from 'react';
import { motion } from 'motion/react';
import { api } from '../lib/api.js';
import { formatDate, year } from '../lib/format.js';
import PostCard from '../components/PostCard.jsx';
import Reveal from '../components/Reveal.jsx';

const ALL = '全部';

const titleGroup = {
  hidden: {},
  show: { transition: { staggerChildren: 0.08, delayChildren: 0.15 } },
};

const titleChar = {
  hidden: { opacity: 0, y: '0.55em', rotate: 4 },
  show: {
    opacity: 1,
    y: 0,
    rotate: 0,
    transition: { type: 'spring', stiffness: 130, damping: 16 },
  },
};

export default function Home({ site }) {
  const [posts, setPosts] = useState(null);
  const [tag, setTag] = useState(ALL);

  useEffect(() => {
    api('/api/posts')
      .then(setPosts)
      .catch(() => setPosts([]));
  }, []);

  useEffect(() => {
    const name = site?.title || '纸间';
    document.title = `${name} · ${site?.subtitle || '写字的地方'}`;
  }, [site]);

  const tags = useMemo(() => {
    if (!posts) return [];
    return [...new Set(posts.flatMap((post) => post.tags || []))];
  }, [posts]);

  const filtered = useMemo(() => {
    if (!posts) return [];
    if (tag === ALL) return posts;
    return posts.filter((post) => (post.tags || []).includes(tag));
  }, [posts, tag]);

  const latest = posts?.[0]?.publishedAt || posts?.[0]?.createdAt;
  const title = site?.title || '纸间';

  return (
    <main className="home">
      <section className="hero">
        <div className="hero__glow" aria-hidden="true" />

        <motion.div className="hero__eyebrow" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.1 }}>
          <span className="hero__pulse" />
          BLOG · {year()}
        </motion.div>

        <motion.h1 className="hero__title" variants={titleGroup} initial="hidden" animate="show" aria-label={title}>
          {Array.from(title).map((char, index) => (
            <motion.span key={`${char}-${index}`} variants={titleChar} className="hero__char">
              {char}
            </motion.span>
          ))}
        </motion.h1>

        <motion.p
          className="hero__sub"
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.45, duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
        >
          {site?.subtitle || '关于代码、阅读与缓慢生活的笔记'}
        </motion.p>

        <motion.div
          className="hero__stats"
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.6, duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
        >
          <span>
            <strong>{posts?.length ?? '—'}</strong> 篇文章
          </span>
          <span className="hero__sep" />
          <span>
            <strong>{tags.length || '—'}</strong> 个标签
          </span>
          <span className="hero__sep" />
          <span>更新于 {latest ? formatDate(latest) : '刚刚开始'}</span>
        </motion.div>

        <motion.div
          className="hero__scroll"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 1 }}
        >
          <motion.span animate={{ y: [0, 6, 0] }} transition={{ repeat: Infinity, duration: 2.2, ease: 'easeInOut' }}>
            ↓
          </motion.span>
          往下看看
        </motion.div>
      </section>

      <section className="feed">
        <div className="feed__head">
          <Reveal className="feed__titles">
            <span className="section-kicker">WRITING</span>
            <h2 className="section-title">最近写的</h2>
          </Reveal>

          <Reveal delay={0.08} className="feed__filters">
            {[ALL, ...tags].map((item) => (
              <button
                key={item}
                type="button"
                className={`chip${tag === item ? ' chip--active' : ''}`}
                onClick={() => setTag(item)}
              >
                {tag === item && (
                  <motion.span
                    layoutId="chip-active"
                    className="chip__bg"
                    transition={{ type: 'spring', stiffness: 380, damping: 32 }}
                  />
                )}
                <span>{item}</span>
              </button>
            ))}
          </Reveal>
        </div>

        {posts === null ? (
          <div className="feed__grid">
            {[0, 1, 2].map((item) => (
              <div key={item} className="post-card post-card--skeleton" />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="empty">
            <p>这个标签下还没有文章。</p>
            <button type="button" className="btn btn--ghost" onClick={() => setTag(ALL)}>
              看全部
            </button>
          </div>
        ) : (
          <motion.div
            className="feed__grid"
            key={tag}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.3 }}
          >
            {filtered.map((post, index) => (
              <PostCard key={post.id} post={post} index={index} featured={index === 0} />
            ))}
          </motion.div>
        )}

        <Reveal className="feed__note" delay={0.1}>
          <span className="feed__note-mark">“</span>
          <p>{site?.tagline || '写字的地方'}——想到就写，写完就发。</p>
        </Reveal>
      </section>
    </main>
  );
}
