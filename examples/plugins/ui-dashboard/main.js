module.exports.activate = (folio) => {
  const percentOf = (book) => {
    const value = Number(book?.percent);
    return Number.isFinite(value) ? Math.round(value) : 0;
  };

  const render = () => {
    const books = folio.books.list() || [];
    const reading = books.filter((book) => percentOf(book) > 0 && percentOf(book) < 100).slice(0, 3);
    const finished = books.filter((book) => percentOf(book) >= 100).length;
    const average = books.length
      ? Math.round(books.reduce((sum, book) => sum + percentOf(book), 0) / books.length)
      : 0;

    folio.ui.set('dashboard', {
      type: 'stack',
      children: [
        {
          type: 'row',
          children: [
            { type: 'metric', value: String(books.length), label: '书架上的书' },
            { type: 'metric', value: String(finished), label: '已读完' },
            { type: 'metric', value: `${average}%`, label: '平均进度' },
          ],
        },
        { type: 'progress', value: average, label: '整体进度' },
        { type: 'divider' },
        { type: 'label', text: '最近在读' },
        reading.length
          ? {
              type: 'list',
              children: reading.map((book) => ({
                type: 'row',
                children: [
                  { type: 'text', text: book.name, tone: 'default' },
                  { type: 'text', text: `${percentOf(book)}%`, tone: 'mono' },
                ],
              })),
            }
          : { type: 'text', text: '还没有读到一半的书', tone: 'mono' },
        { type: 'spacer' },
        {
          type: 'row',
          children: [
            { type: 'button', text: '刷新', size: 'small', action: { id: 'refresh' } },
            { type: 'button', text: '随机推荐一本', size: 'small', action: { id: 'random' } },
          ],
        },
      ],
    });
  };

  folio.ui.onAction(async (action) => {
    if (action.id === 'refresh' || action.command === 'refresh') {
      render();
      return '已刷新';
    }
    if (action.id === 'random' || action.command === 'random') {
      const books = (folio.books.list() || []).filter((book) => percentOf(book) < 100);
      if (!books.length) {
        folio.notify('书架里没有未读完的书', 'error');
        return null;
      }
      const book = books[Math.floor(Math.random() * books.length)];
      folio.notify(`今天读《${book.name}》`);
      return book.name;
    }
    return null;
  });

  folio.commands.register('open', '打开阅读面板', () => {
    render();
    folio.ui.open('dashboard');
    return '已打开阅读面板';
  });

  render();
};
