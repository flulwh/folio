module.exports.activate = (folio) => {
  const pool = () => {
    const onlyUnfinished = folio.settings.get('onlyUnfinished', true);
    const books = folio.books.list() || [];
    const filtered = onlyUnfinished
      ? books.filter((book) => Number(book.percent || 0) < 99)
      : books;
    return (filtered.length ? filtered : books).map((book) => book.name).filter(Boolean);
  };

  const pick = (list, count) => {
    const copy = [...list];
    const out = [];
    while (copy.length && out.length < count) {
      out.push(copy.splice(Math.floor(Math.random() * copy.length), 1)[0]);
    }
    return out;
  };

  folio.commands.register('shuffle', '随机抽一本', () => {
    const list = pool();
    if (!list.length) {
      folio.notify('书架是空的，先加几本书吧', 'error');
      return null;
    }
    const name = pick(list, 1)[0];
    folio.notify(`今天就读《${name}》吧`);
    return name;
  });

  folio.commands.register('three', '抽三本备选', () => {
    const list = pool();
    if (!list.length) {
      folio.notify('书架是空的，先加几本书吧', 'error');
      return [];
    }
    const picked = pick(list, 3);
    folio.notify(`候选：${picked.map((name) => `《${name}》`).join('、')}`);
    return picked;
  });
};
