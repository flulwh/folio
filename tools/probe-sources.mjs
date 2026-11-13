/**
 * 漫画书源端到端探针（开发用，不参与打包）。
 *
 * 用法：
 *   node tools/probe-sources.mjs <Folio-data 目录> [关键词] [书源名过滤] [阶段]
 * 例：
 *   node tools/probe-sources.mjs release/win-unpacked/Folio-data 的
 *   node tools/probe-sources.mjs release/win-unpacked/Folio-data 的 包子 search
 *   stage: search | info | toc | content | all（默认 all），content 需要先有搜索结果
 *
 * 只读 sources.json，缓存写临时目录，不会污染真实数据。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { searchSource, fetchBookInfo, fetchToc, fetchChapter, extractImages } from '../electron/sources.js';

const dataDir = path.resolve(process.argv[2] || 'release/win-unpacked/Folio-data');
const keyword = process.argv[3] || '的';
const nameFilter = process.argv[4] || '';
const stage = process.argv[5] || 'all';

const raw = JSON.parse(fs.readFileSync(path.join(dataDir, 'sources.json'), 'utf8'));
const list = (Array.isArray(raw) ? raw : raw.sources || []).filter((s) => s.enabled !== false);
const cacheRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'folio-probe-'));

const pick = (text, n = 120) => String(text ?? '').replace(/\s+/g, ' ').slice(0, n);
const fmt = (o) => JSON.stringify(o);

for (const source of list) {
  if (nameFilter && !source.name.includes(nameFilter)) continue;
  const line = { source: source.name, id: source.id, type: source.type };
  try {
    const t0 = Date.now();
    const results = await searchSource(source, keyword, 1, { cacheRoot });
    line.search = {
      count: results.length,
      ms: Date.now() - t0,
      sample: results.slice(0, 2).map((r) => `${r.name} / ${r.author || '-'} / ${pick(r.bookUrl, 90)}`),
    };
    if (!results.length) {
      console.log(fmt(line));
      continue;
    }
    const first = results[0];
    if (stage === 'all' || stage === 'info') {
      try {
        const info = await fetchBookInfo(source, first.bookUrl, { cacheRoot });
        line.info = info ? Object.fromEntries(Object.entries(info).map(([k, v]) => [k, pick(v, 80)])) : '(null)';
      } catch (err) {
        line.info = `ERR ${err.message}`;
      }
    }
    if (stage === 'all' || stage === 'toc' || stage === 'content') {
      try {
        const toc = await fetchToc(source, first.bookUrl, null, { cacheRoot, bookInfo: line.info });
        line.toc = { count: toc.chapters.length, fallback: toc.fallback || null, first: toc.chapters.slice(0, 2).map((c) => `${c.title} -> ${pick(c.url, 90)}`) };
        const chapters = toc.chapters;
        if ((stage === 'all' || stage === 'content') && chapters.length) {
          const idx = Math.min(chapters.length - 1, Math.floor(chapters.length / 2));
          const chapter = chapters[idx];
          try {
            const page = await fetchChapter(source, chapter.url, first.bookUrl, chapter, { cacheRoot });
            line.content = { chars: page.text.replace(/\s+/g, '').length, fallback: page.fallback || null, head: pick(page.text, 120) };
          } catch (err) {
            line.content = `ERR ${err.message}`;
          }
          if (source.type === 2) {
            try {
              const tocCache = toc; // images 需要页面 HTML：这里直接再抓一次章节页
              const { url: finalUrl, html } = await (await import('../electron/sources.js')).fetchPage(source, chapter.url, { bookUrl: first.bookUrl }, {});
              const urls = extractImages(html, source.content?.rule || '', finalUrl, {
                source,
                cacheRoot,
                bindings: { chapter, title: chapter.title, bookUrl: first.bookUrl, baseUrl: source.baseUrl },
              });
              line.images = { count: urls.length, sample: urls.slice(0, 2).map((u) => pick(u, 100)) };
              void tocCache;
            } catch (err) {
              line.images = `ERR ${err.message}`;
            }
          }
        }
      } catch (err) {
        line.toc = `ERR ${err.message}`;
      }
    }
  } catch (err) {
    line.search = `ERR ${err.message}`;
  }
  console.log(fmt(line));
}
console.log('cacheRoot=', cacheRoot);
