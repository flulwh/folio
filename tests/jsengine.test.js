import { describe, it, expect } from 'vitest';
import { getRuntime } from '../electron/jsengine.js';

describe('jsengine 的 jsLib 快照', () => {
  it('同一个书源、jsLib 没变时复用上下文', () => {
    const source = { id: 'lib-reuse', jsLib: 'function libVersion() { return 1; }' };
    expect(getRuntime(source).run('libVersion()')).toBe(1);
    expect(getRuntime(source)).toBe(getRuntime(source));
  });

  it('jsLib 变了以后重建上下文，旧函数不再生效', () => {
    const before = { id: 'lib-swap', jsLib: 'function libVersion() { return 1; }' };
    expect(getRuntime(before).run('libVersion()')).toBe(1);
    const after = { id: 'lib-swap', jsLib: 'function libVersion() { return 2; }' };
    expect(getRuntime(after).run('libVersion()')).toBe(2);
  });

  it('没有 jsLib 的源不会互相干扰', () => {
    const a = { id: 'no-lib-a' };
    const b = { id: 'no-lib-b' };
    expect(getRuntime(a)).not.toBe(getRuntime(b));
  });
});
