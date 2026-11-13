module.exports.activate = (folio) => {
  const MAX = 60;
  let quotes = Array.isArray(folio.storage.get('quotes', [])) ? folio.storage.get('quotes', []) : [];
  let draft = '';

  const save = () => {
    const text = String(draft || '').trim();
    if (!text) {
      folio.notify('先写一句再存', 'error');
      return '空';
    }
    quotes = [text, ...quotes.filter((item) => item !== text)].slice(0, MAX);
    folio.storage.set('quotes', quotes);
    draft = '';
    folio.notify('已收进书摘本，共 ' + quotes.length + ' 句');
    render();
    return 'saved';
  };

  const render = () => {
    const children = [
      {
        type: 'input',
        name: 'quote',
        placeholder: '写下想留下的句子…',
        value: draft,
        action: { id: 'draft' },
      },
      {
        type: 'row',
        children: [
          { type: 'button', text: '保存', action: { id: 'save' } },
          { type: 'button', text: '随机一句', action: { id: 'random' } },
          { type: 'button', text: '清空', action: { id: 'clear' }, tone: 'danger' },
        ],
      },
      { type: 'divider' },
      { type: 'label', text: '共 ' + quotes.length + ' 句' },
    ];

    const recent = quotes.slice(0, 12);
    if (!recent.length) {
      children.push({ type: 'text', text: '还没有书摘，写下第一句吧。', tone: 'mono' });
    } else {
      children.push({
        type: 'list',
        children: recent.map((text, index) => ({
          type: 'row',
          children: [
            { type: 'text', text: text.length > 60 ? text.slice(0, 60) + '…' : text },
            { type: 'button', text: '复制', size: 'small', action: { id: 'copy', payload: { index } } },
          ],
        })),
      });
    }

    folio.ui.set('quotes', { type: 'stack', children });
  };

  const random = () => {
    if (!quotes.length) {
      folio.notify('书摘本还是空的', 'error');
      return null;
    }
    const text = quotes[Math.floor(Math.random() * quotes.length)];
    folio.notify(text);
    return text;
  };

  render();
  if (folio.settings.get('showOnOpen', true)) render();

  folio.commands.register('open', '打开书摘本', () => {
    render();
    folio.ui.open('quotes');
    return '已打开';
  });
  folio.commands.register('random', '随机来一句', () => random());

  folio.ui.onAction((action) => {
    if (action.type === 'input' && action.name === 'quote') {
      draft = action.value || '';
      return null;
    }
    if (action.id === 'save') return save();
    if (action.id === 'random') return random();
    if (action.id === 'clear') {
      quotes = [];
      folio.storage.set('quotes', []);
      draft = '';
      render();
      folio.notify('书摘本已清空');
      return 'cleared';
    }
    if (action.id === 'copy') {
      const index = Number(action.payload?.index);
      const text = quotes[index];
      if (!text) return null;
      folio.clipboard.write(text);
      folio.notify('已复制');
      return text;
    }
    return null;
  });

  return () => {
    folio.storage.set('quotes', quotes);
  };
};
