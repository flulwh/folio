import { motion } from 'motion/react';
import { Link } from '../lib/router.jsx';
import { formatDate } from '../lib/format.js';

export default function PostCard({ post, index = 0, featured = false }) {
  const glyph = Array.from(post.title || '文')[0];

  return (
    <motion.article
      className={`post-card${featured ? ' post-card--feature' : ''}`}
      initial={{ opacity: 0, y: 30 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-40px' }}
      transition={{ type: 'spring', stiffness: 90, damping: 18, delay: Math.min(index, 4) * 0.06 }}
      whileHover={{ y: -6 }}
    >
      <Link href={`/post/${encodeURIComponent(post.slug)}`} className="post-card__link">
        <div className={`post-card__cover accent-${post.accent}`} aria-hidden="true">
          {post.cover ? (
            <img src={post.cover} alt="" loading="lazy" />
          ) : (
            <span className="post-card__glyph">{glyph}</span>
          )}
          <span className="post-card__index">{String(index + 1).padStart(2, '0')}</span>
        </div>

        <div className="post-card__body">
          <div className="post-card__meta">
            <span>{formatDate(post.publishedAt || post.createdAt)}</span>
            <span className="post-card__dot" />
            <span>{post.readingMinutes || 3} 分钟</span>
          </div>

          <h2 className="post-card__title">{post.title}</h2>
          <p className="post-card__excerpt">{post.excerpt}</p>

          <div className="post-card__foot">
            <div className="post-card__tags">
              {(post.tags || []).map((tag) => (
                <span key={tag} className="tag">
                  {tag}
                </span>
              ))}
            </div>
            <span className="post-card__more">
              阅读
              <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.8">
                <path d="M5 12h14M13 6l6 6-6 6" />
              </svg>
            </span>
          </div>
        </div>
      </Link>
    </motion.article>
  );
}
