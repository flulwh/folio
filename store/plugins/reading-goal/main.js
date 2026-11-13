module.exports.activate = (folio) => {
  const goal = () => Math.min(300, Math.max(5, Number(folio.settings.get('dailyMinutes', 30)) || 30));
  const dayKey = (offset = 0) => {
    const date = new Date();
    date.setDate(date.getDate() - offset);
    return 'day:' + date.getFullYear() + '-' + (date.getMonth() + 1) + '-' + date.getDate();
  };
  const readSeconds = (key) => Number(folio.storage.get(key, 0)) || 0;
  let lastSaveAt = 0;
  let lastDay = dayKey(0);
  let reminded = false;

  const todaySeconds = () => readSeconds(dayKey(0));
  const streak = () => {
    let count = 0;
    for (let offset = 0; offset < 365; offset += 1) {
      const seconds = readSeconds(dayKey(offset));
      if (offset === 0 && seconds < 60) continue;
      if (seconds >= 60) count += 1;
      else break;
    }
    return count;
  };

  const render = () => {
    const minutes = Math.round(todaySeconds() / 60);
    const pct = Math.min(100, Math.round((minutes / goal()) * 100));
    const week = [];
    for (let offset = 6; offset >= 0; offset -= 1) {
      const date = new Date();
      date.setDate(date.getDate() - offset);
      const label = offset === 0 ? '今天' : (date.getMonth() + 1) + '/' + date.getDate();
      week.push({ type: 'row', children: [
        { type: 'label', text: label },
        { type: 'text', text: Math.round(readSeconds(dayKey(offset)) / 60) + ' 分钟', tone: offset === 0 ? 'accent' : 'mono' },
      ]});
    }
    folio.ui.set('goal', {
      type: 'stack',
      children: [
        { type: 'metric', value: minutes + ' / ' + goal(), label: '今天 / 目标（分钟）' },
        { type: 'progress', value: pct, label: pct >= 100 ? '今天已完成 🎉' : '还差 ' + Math.max(0, goal() - minutes) + ' 分钟' },
        { type: 'divider' },
        { type: 'row', children: [
          { type: 'metric', value: String(streak()), label: '连续天数' },
          { type: 'metric', value: String(Math.round(todaySeconds() / 60)), label: '今日分钟' },
        ]},
        { type: 'label', text: '最近 7 天' },
        { type: 'list', children: week },
      ],
    });
  };

  const onSave = () => {
    const now = Date.now();
    const today = dayKey(0);
    if (lastSaveAt && now - lastSaveAt < 120000) {
      const delta = Math.max(0, Math.min(120, Math.round((now - lastSaveAt) / 1000)));
      if (delta > 0) {
        const next = readSeconds(today) + delta;
        folio.storage.set(today, next);
        const minutes = Math.round(next / 60);
        if (!reminded && minutes >= goal() && folio.settings.get('notifyOnDone', true)) {
          reminded = true;
          folio.notify('今天已经读了 ' + minutes + ' 分钟，目标完成 🎉');
        }
        render();
      }
    }
    if (lastDay !== today) {
      lastDay = today;
      reminded = false;
    }
    lastSaveAt = now;
  };

  render();

  folio.commands.register('open', '打开阅读目标', () => {
    render();
    folio.ui.open('goal');
    return '已打开';
  });
  folio.commands.register('today', '今天读了多少', () => {
    const minutes = Math.round(todaySeconds() / 60);
    folio.notify('今天 ' + minutes + ' 分钟，目标 ' + goal() + ' 分钟。');
    return minutes;
  });

  folio.ui.onAction((action) => {
    if (action.id === 'refresh') {
      render();
      return '已刷新';
    }
    return null;
  });

  folio.events.on('progress:save', onSave);

  return () => {
    render();
  };
};
