const DEFAULT_QUOTES = [
  '一本书就是一个世界，一次阅读就是一趟旅程。',
  '读书不是为了雄辩和驳斥，也不是为了轻信和盲从，而是为了思考和权衡。',
  '我们读书，然后就不孤单。',
  '你读过的书，会悄悄变成你脚下的路。',
];

module.exports.activate = (folio) => {
  const quotes = () => {
    const custom = String(folio.settings.get('quotesText', '') || '')
      .split('|')
      .map((item) => item.trim())
      .filter(Boolean);
    return custom.length ? custom : DEFAULT_QUOTES;
  };

  folio.commands.register('quote', '来一句书摘', () => {
    const pool = quotes();
    const pick = pool[Math.floor(Math.random() * pool.length)];
    folio.notify(pick);
    return pick;
  });
};
