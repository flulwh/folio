import { describe, it, expect } from 'vitest';
import {
  parseVersion,
  compareVersions,
  pickRelease,
  normalizeNotices,
} from '../electron/update.js';

describe('parseVersion', () => {
  it('去掉 v / android- 前缀与预发布后缀', () => {
    expect(parseVersion('v2.15.0')).toEqual([2, 15, 0]);
    expect(parseVersion('android-4.5.0')).toEqual([4, 5, 0]);
    expect(parseVersion('2.15.0-beta.1')).toEqual([2, 15, 0]);
  });

  it('空值与非法段按 0 处理', () => {
    expect(parseVersion('')).toEqual([0]);
    expect(parseVersion('2.x.1')).toEqual([2, 0, 1]);
  });
});

describe('compareVersions', () => {
  it('按数值而不是字符串比较', () => {
    expect(compareVersions('2.15.0', '2.9.0')).toBe(1);
    expect(compareVersions('v2.9.0', '2.15.0')).toBe(-1);
    expect(compareVersions('2.15.0', '2.15.0')).toBe(0);
  });

  it('缺省段按 0 比较', () => {
    expect(compareVersions('2.15', '2.15.0')).toBe(0);
    expect(compareVersions('2.15.1', '2.15')).toBe(1);
  });

  it('桌面与安卓版本线各自比较', () => {
    expect(compareVersions('android-4.5.0', '4.4.0')).toBe(1);
  });
});

describe('pickRelease', () => {
  const releases = [
    { tag_name: 'v2.9.0', published_at: '2026-11-01T00:00:00Z' },
    { tag_name: 'v2.15.0', published_at: '2026-11-20T00:00:00Z' },
    { tag_name: 'android-4.5.0', published_at: '2026-11-21T00:00:00Z' },
    { tag_name: 'v3.0.0', draft: true },
    { tag_name: 'v2.16.0', prerelease: true },
    { tag_name: 'nightly' },
  ];

  it('只认 v* 标签，跳过草稿与预发布', () => {
    expect(pickRelease(releases).tag_name).toBe('v2.15.0');
  });

  it('标签乱序时仍取版本号最大的', () => {
    const shuffled = [
      { tag_name: 'v2.9.0' },
      { tag_name: 'v2.15.0' },
      { tag_name: 'v2.10.0' },
    ];
    expect(pickRelease(shuffled).tag_name).toBe('v2.15.0');
  });

  it('没有匹配项时返回 null', () => {
    expect(pickRelease([])).toBeNull();
    expect(pickRelease(null)).toBeNull();
  });
});

describe('normalizeNotices', () => {
  const now = new Date(2026, 10, 21);

  it('丢弃缺 id / 缺标题 / 已停用 / 已过期的公告', () => {
    const result = normalizeNotices(
      {
        notices: [
          { id: 'a', title: '保留', date: '2026-11-20' },
          { title: '没有 id' },
          { id: 'b', title: '' },
          { id: 'c', title: '停用', active: false },
          { id: 'd', title: '过期', expiresAt: '2026-11-20' },
        ],
      },
      now,
    );
    expect(result.map((n) => n.id)).toEqual(['a']);
  });

  it('按日期倒序并裁剪字段', () => {
    const result = normalizeNotices(
      {
        notices: [
          { id: 'old', title: '旧', date: '2026-11-01', body: 123, url: 'javascript:alert(1)' },
          { id: 'new', title: '新', date: '2026-11-20', level: 'warn', url: 'https://example.com' },
        ],
      },
      now,
    );
    expect(result.map((n) => n.id)).toEqual(['new', 'old']);
    expect(result[1].body).toBe('');
    expect(result[1].url).toBe('');
    expect(result[0].level).toBe('warn');
  });

  it('非数组输入返回空列表', () => {
    expect(normalizeNotices(null, now)).toEqual([]);
    expect(normalizeNotices({ notices: 'x' }, now)).toEqual([]);
  });
});
