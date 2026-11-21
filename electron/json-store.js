import { LowSync } from 'lowdb';

/**
 * 一个 JSON 文件对应一个 LowSync 实例。
 *
 * 数据持有、读写节奏交给 lowdb；真正的读盘/写盘仍然走主进程现成的容错实现：
 * - 读：坏文件降级到默认值，不拦启动；
 * - 写：tmp+rename 原子写、写失败回退直写、缩水前留 `.bak`。
 * lowdb 自带的 JSONFile 适配器没有这些恢复语义，直接换会退化成「无备份直接覆盖」。
 *
 * @param {object} options
 * @param {string} options.file 目标文件
 * @param {unknown} options.fallback 文件不存在或损坏时的默认值
 * @param {(file: string, fallback: unknown) => unknown} options.read 容错读盘
 * @param {(file: string, data: unknown) => { ok: boolean, error?: string }} options.write 容错写盘
 */
export function createJsonStore({ file, fallback, read, write }) {
  // 同一个文件可能被不同调用点用不同默认值读取（例如 settings 有 {} 和 null 两种），
  // 所以默认值按「本次读取」传入，而不是固定在构造时。
  let currentFallback = fallback;

  const adapter = {
    lastResult: { ok: true },
    read: () => read(file, currentFallback),
    write: (data) => {
      adapter.lastResult = write(file, data);
    },
  };

  const db = new LowSync(adapter, fallback);

  return {
    read(fallbackValue = fallback) {
      currentFallback = fallbackValue;
      db.read();
      return db.data === undefined ? fallbackValue : db.data;
    },
    write(data) {
      db.data = data;
      db.write();
      return adapter.lastResult || { ok: true };
    },
  };
}
