const DAY = () => new Date().toISOString().slice(0, 10);

module.exports.activate = (folio) => {
  let lastTick = 0;

  const key = () => `day:${DAY()}`;
  const read = () => folio.storage.get(key(), { seconds: 0, saves: 0, books: [] });
  const write = (bucket) => folio.storage.set(key(), bucket);

  folio.events.on('progress:save', () => {
    const now = Date.now();
    const delta = lastTick ? Math.min(120, Math.max(0, (now - lastTick) / 1000)) : 0;
    lastTick = now;
    if (delta <= 0) return;
    const bucket = read();
    bucket.seconds = Math.round((bucket.seconds || 0) + delta);
    bucket.saves = (bucket.saves || 0) + 1;
    write(bucket);
    if (folio.settings.get('notifyOnSave', false)) {
      folio.notify(`已累计 ${Math.round(bucket.seconds / 60)} 分钟`);
    }
  });

  folio.events.on('book:open', ({ name } = {}) => {
    if (!name) return;
    const bucket = read();
    bucket.books = Array.from(new Set([...(bucket.books || []), name])).slice(-20);
    write(bucket);
  });

  folio.commands.register('today', '今日阅读统计', () => {
    const bucket = read();
    const minutes = Math.floor((bucket.seconds || 0) / 60);
    const seconds = Math.round((bucket.seconds || 0) % 60);
    const goal = Math.max(1, Number(folio.settings.get('dailyGoal', 30)) || 30);
    const left = Math.max(0, goal - minutes);
    const books = (bucket.books || []).length;
    folio.notify(
      `今天读了 ${minutes} 分 ${seconds} 秒，翻过 ${books} 本书。${left > 0 ? `离 ${goal} 分钟的目标还差 ${left} 分钟。` : '今天的目标已完成。'}`,
    );
    return { seconds: bucket.seconds || 0, books: bucket.books || [], goal };
  });

  folio.commands.register('reset', '清零今天的记录', () => {
    write({ seconds: 0, saves: 0, books: [] });
    folio.notify('今天的记录已清零');
    return true;
  });
};
