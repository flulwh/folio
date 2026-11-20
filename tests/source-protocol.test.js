import { describe, it, expect } from 'vitest';
import {
  SOURCE_METHODS,
  callMessage,
  errorMessage,
  isCallMessage,
  isResultMessage,
  isSourceMethod,
  logMessage,
  resultMessage,
  serializeError,
} from '../electron/source-protocol.js';

describe('source-protocol', () => {
  it('只放行白名单里的书源方法', () => {
    for (const method of SOURCE_METHODS) expect(isSourceMethod(method)).toBe(true);
    expect(isSourceMethod('exec')).toBe(false);
    expect(isSourceMethod('')).toBe(false);
    expect(isSourceMethod(null)).toBe(false);
  });

  it('callMessage 把非数组参数收进数组', () => {
    expect(callMessage(3, 'search', 'kw')).toEqual({ kind: 'call', id: 3, method: 'search', args: ['kw'] });
  });

  it('isCallMessage 校验 id 与 method', () => {
    expect(isCallMessage(callMessage(1, 'toc', []))).toBe(true);
    expect(isCallMessage({ kind: 'call', id: 0, method: 'toc', args: [] })).toBe(false);
    expect(isCallMessage({ kind: 'call', id: 1.5, method: 'toc', args: [] })).toBe(false);
    expect(isCallMessage({ kind: 'call', id: 1, method: 'rm -rf', args: [] })).toBe(false);
    expect(isCallMessage(null)).toBe(false);
  });

  it('成功与失败响应都带同一个 id', () => {
    expect(resultMessage(7, { ok: 1 })).toEqual({ kind: 'result', id: 7, ok: true, value: { ok: 1 } });
    expect(errorMessage(7, new Error('boom'))).toEqual({
      kind: 'result',
      id: 7,
      ok: false,
      error: { message: 'boom' },
    });
    expect(isResultMessage(resultMessage(7, null))).toBe(true);
    expect(isResultMessage({ kind: 'result', id: -1 })).toBe(false);
  });

  it('serializeError 截断消息并保留 code', () => {
    const long = new Error('x'.repeat(900));
    const serialized = serializeError(long);
    expect(serialized.message).toHaveLength(500);
    expect(serialized.code).toBeUndefined();

    const coded = new Error('timeout');
    coded.code = 'ETIMEDOUT';
    expect(serializeError(coded)).toEqual({ message: 'timeout', code: 'ETIMEDOUT' });

    expect(serializeError('plain')).toEqual({ message: 'plain' });
    expect(serializeError(null)).toEqual({ message: '书源引擎出错' });
  });

  it('logMessage 归一化级别并忽略非对象 extra', () => {
    expect(logMessage('nope', 'net', 'hi')).toMatchObject({ kind: 'log', level: 'info', tag: 'net', message: 'hi' });
    expect(logMessage('warn', '', 'x', 'not-an-object').extra).toBeUndefined();
    expect(logMessage('warn', '', 'x', { source: 'a' }).extra).toEqual({ source: 'a' });
  });
});
