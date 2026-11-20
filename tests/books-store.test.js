import { describe, it, expect } from 'vitest';
import { createBooksStore } from '../electron/lan-books.js';
import { loadPrivateFunctions } from './helpers/source.mjs';

// 与渲染层同源的「本地意图重放」纯函数（AppStore.jsx 里的模块级函数）
const { rebaseBooks } = loadPrivateFunctions('src/store/AppStore.jsx', ['rebaseBooks']);

/** 内存版 books.json：writeJson 每次深拷一份，方便断言磁盘上到底落了什么。 */
function createHarness(initial = []) {
  let disk = JSON.parse(JSON.stringify(initial));
  const files = { books: 'books.json' };
  const readJson = () => JSON.parse(JSON.stringify(disk));
  const writeJson = (_file, data) => {
    disk = JSON.parse(JSON.stringify(data));
    return { ok: true };
  };
  return {
    files,
    readJson,
    writeJson,
    get disk() {
      return disk;
    },
  };
}

const ids = (list) => list.map((book) => book.id);

describe('createBooksStore', () => {
  it('基版本过期时拒绝写入并回传最新列表', () => {
    const harness = createHarness([{ id: 'a', tags: ['旧'] }]);
    const store = createBooksStore(harness);

    expect(store.revision).toBe(0);
    const first = store.set([{ id: 'a', tags: ['新'] }], 0);
    expect(first).toMatchObject({ ok: true, revision: 1 });

    const stale = store.set([{ id: 'only-desktop' }], 0);
    expect(stale).toMatchObject({ ok: false, stale: true, revision: 1 });
    expect(stale.books).toEqual([{ id: 'a', tags: ['新'] }]);
    // 过期写入绝不能落盘
    expect(harness.disk).toEqual([{ id: 'a', tags: ['新'] }]);
  });

  it('不传基版本（旧渲染层）仍保持整份覆盖语义', () => {
    const harness = createHarness([{ id: 'a' }]);
    const store = createBooksStore(harness);
    const result = store.set([{ id: 'b' }]);
    expect(result).toMatchObject({ ok: true, revision: 1 });
    expect(harness.disk).toEqual([{ id: 'b' }]);
  });

  it('revision 只随成功写盘单调递增，过期写入不推进', () => {
    const harness = createHarness([]);
    const store = createBooksStore(harness);

    let last = store.revision;
    for (let i = 0; i < 4; i += 1) {
      const result = store.set([{ id: `book-${i}` }], last);
      expect(result.ok).toBe(true);
      expect(result.revision).toBe(last + 1);
      last = result.revision;
    }

    // 局域网内部写者（手机上传 / hash 补齐）同样推进 revision
    const committed = store.commit([{ id: 'lan-book' }], 'lan-upload');
    expect(committed.revision).toBe(last + 1);
    last = committed.revision;

    const stale = store.set([{ id: 'lost' }], last - 1);
    expect(stale.stale).toBe(true);
    expect(store.revision).toBe(last);
  });

  it('写盘失败时不推进 revision，内存副本保持不变', () => {
    const harness = createHarness([{ id: 'a' }]);
    const store = createBooksStore({
      ...harness,
      writeJson: () => ({ ok: false, error: 'disk full' }),
    });

    const result = store.set([{ id: 'b' }], 0);
    expect(result).toMatchObject({ ok: false, error: 'disk full' });
    expect(store.revision).toBe(0);
    expect(store.list()).toEqual([{ id: 'a' }]);
  });
});

describe('局域网变更与渲染层保存交错', () => {
  it('手机上传先落盘：桌面端过期保存重放标签，手机新书不丢', () => {
    const harness = createHarness([{ id: 'a', name: 'A' }]);
    const store = createBooksStore(harness);

    // 桌面端读到的基版本
    const rendererBase = store.state().books;
    // 桌面端改标签，还停在防抖窗口里
    const local = [{ id: 'a', name: 'A', tags: ['想读'] }];

    // 手机上传一本新书（局域网侧的 register 等价操作）
    const lanList = store.list();
    lanList.push({ id: 'sha1-phone', name: '手机书' });
    store.commit(lanList, 'lan-upload');
    expect(store.revision).toBe(1);

    // 桌面端带着过期基版本保存 → 被拒
    const stale = store.set(local, 0);
    expect(stale.stale).toBe(true);

    // 用最新列表重放桌面端意图，再写一次
    const merged = rebaseBooks(rendererBase, local, stale.books);
    expect(ids(merged)).toEqual(['sha1-phone', 'a']);
    expect(merged.find((book) => book.id === 'a').tags).toEqual(['想读']);

    const saved = store.set(merged, stale.revision);
    expect(saved.ok).toBe(true);

    // 磁盘上两边的改动都在
    expect(ids(harness.disk)).toEqual(['sha1-phone', 'a']);
    expect(harness.disk.find((book) => book.id === 'a').tags).toEqual(['想读']);
  });

  it('桌面端先落盘：手机随后追加新书，桌面端标签仍在', () => {
    const harness = createHarness([{ id: 'a', name: 'A' }]);
    const store = createBooksStore(harness);

    const desktop = store.set([{ id: 'a', name: 'A', tags: ['在读'] }], 0);
    expect(desktop.ok).toBe(true);

    // 手机读到的已是最新列表（含桌面端刚改的标签），追加后整份提交
    const lanList = store.list();
    lanList.push({ id: 'sha1-phone', name: '手机书' });
    store.commit(lanList, 'lan-upload');

    expect(ids(harness.disk)).toEqual(['a', 'sha1-phone']);
    expect(harness.disk.find((book) => book.id === 'a').tags).toEqual(['在读']);
  });

  it('本地删除不会被远端旧列表复活，远端新增照常合并', () => {
    const base = [{ id: 'a' }, { id: 'b' }];
    const harness = createHarness(base);
    const store = createBooksStore(harness);

    // 桌面端删掉 b（本地意图，尚未落盘）
    const local = [{ id: 'a' }];
    // 手机加了一本新书
    const lanList = store.list();
    lanList.push({ id: 'sha1-phone' });
    store.commit(lanList, 'lan-upload');

    const stale = store.set(local, 0);
    expect(stale.stale).toBe(true);

    const merged = rebaseBooks(base, local, stale.books);
    expect(ids(merged)).toEqual(['sha1-phone', 'a']);
  });
});
