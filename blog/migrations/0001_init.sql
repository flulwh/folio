CREATE TABLE IF NOT EXISTS posts (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  excerpt TEXT NOT NULL DEFAULT '',
  content TEXT NOT NULL DEFAULT '',
  tags TEXT NOT NULL DEFAULT '[]',
  cover TEXT,
  accent TEXT NOT NULL DEFAULT 'ember',
  status TEXT NOT NULL DEFAULT 'draft',
  reading_minutes INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  published_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_posts_status ON posts (status);
CREATE INDEX IF NOT EXISTS idx_posts_published ON posts (published_at);

CREATE TABLE IF NOT EXISTS site (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  title TEXT NOT NULL,
  subtitle TEXT NOT NULL,
  author TEXT NOT NULL,
  tagline TEXT NOT NULL,
  links TEXT NOT NULL DEFAULT '[]'
);

INSERT OR IGNORE INTO site (id, title, subtitle, author, tagline, links)
VALUES (
  1,
  '纸间',
  '关于代码、阅读与缓慢生活的笔记',
  'lwh',
  '写字的地方',
  '[{"label":"GitHub","href":"https://github.com/"}]'
);
