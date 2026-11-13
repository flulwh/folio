module.exports.activate = (folio) => {
  const PRESETS = [
    { id: 'compact', label: '紧凑', hint: '信息密度高，适合快速翻', values: { fontSize: 16, lineHeight: 1.6, pageWidth: 620, paragraphSpacing: 0.6 } },
    { id: 'comfort', label: '舒适', hint: '默认的阅读节奏', values: { fontSize: 18, lineHeight: 1.85, pageWidth: 700, paragraphSpacing: 1 } },
    { id: 'large', label: '大字', hint: '字号大、行距松，夜里看更轻松', values: { fontSize: 21, lineHeight: 2, pageWidth: 760, paragraphSpacing: 1.2 } },
  ];

  const current = () => {
    const settings = folio.app.settings.get() || {};
    return {
      fontSize: Number(settings.fontSize) || 18,
      lineHeight: Number(settings.lineHeight) || 1.85,
      pageWidth: Number(settings.pageWidth) || 700,
      paragraphSpacing: Number(settings.paragraphSpacing) || 1,
    };
  };

  const apply = (id) => {
    const preset = PRESETS.find((item) => item.id === id);
    if (!preset) return null;
    folio.app.settings.patch(preset.values);
    folio.notify('已切到「' + preset.label + '」排版');
    render();
    return preset.label;
  };

  const render = () => {
    const now = current();
    folio.ui.set('presets', {
      type: 'stack',
      children: [
        { type: 'label', text: '当前' },
        { type: 'row', children: [
          { type: 'metric', value: String(now.fontSize) + 'px', label: '字号' },
          { type: 'metric', value: String(now.lineHeight), label: '行距' },
          { type: 'metric', value: String(now.pageWidth) + 'px', label: '正文宽度' },
        ]},
        { type: 'divider' },
        {
          type: 'list',
          children: PRESETS.map((preset) => ({
            type: 'row',
            children: [
              { type: 'text', text: preset.label + ' · ' + preset.hint },
              { type: 'button', text: '应用', size: 'small', action: { id: 'apply', payload: { preset: preset.id } } },
            ],
          })),
        },
        { type: 'text', text: '改动会立刻写进阅读设置，也可以在阅读器里按 S 微调。', tone: 'mono' },
      ],
    });
  };

  render();

  folio.commands.register('open', '打开排版预设', () => {
    render();
    folio.ui.open('presets');
    return '已打开';
  });
  folio.commands.register('compact', '切到紧凑排版', () => apply('compact'));
  folio.commands.register('comfort', '切到舒适排版', () => apply('comfort'));
  folio.commands.register('large', '切到大字排版', () => apply('large'));

  folio.ui.onAction((action) => {
    if (action.id === 'apply') return apply(action.payload?.preset);
    if (action.id === 'refresh') {
      render();
      return '已刷新';
    }
    return null;
  });
};
