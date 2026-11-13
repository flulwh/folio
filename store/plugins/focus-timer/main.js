module.exports.activate = (folio) => {
  const focusMinutes = () => Math.min(120, Math.max(1, Number(folio.settings.get('focusMinutes', 25)) || 25));
  const breakMinutes = () => Math.min(30, Math.max(0, Number(folio.settings.get('breakMinutes', 5)) || 0));
  const state = { mode: 'idle', remaining: 0, sessions: 0, timer: null };

  const dayKey = () => {
    const now = new Date();
    return 'sessions:' + now.getFullYear() + '-' + (now.getMonth() + 1) + '-' + now.getDate();
  };
  const loadSessions = () => Number(folio.storage.get(dayKey(), 0)) || 0;
  const saveSessions = () => folio.storage.set(dayKey(), state.sessions);

  const clock = (seconds) => {
    const total = Math.max(0, Math.round(seconds));
    const mm = String(Math.floor(total / 60)).padStart(2, '0');
    const ss = String(total % 60).padStart(2, '0');
    return mm + ':' + ss;
  };

  const stopTimer = () => {
    if (state.timer) {
      clearInterval(state.timer);
      state.timer = null;
    }
  };

  const render = () => {
    const total = (state.mode === 'break' ? breakMinutes() : focusMinutes()) * 60;
    const done = state.mode === 'idle' ? 0 : Math.max(0, Math.min(100, total ? Math.round(((total - state.remaining) / total) * 100) : 0));
    const label = state.mode === 'idle' ? '准备开始' : state.mode === 'break' ? '休息中' : '专注中';
    const primary = state.mode === 'idle' ? { id: 'start' } : state.timer ? { id: 'pause' } : { id: 'resume' };
    const primaryText = state.mode === 'idle' ? '开始专注' : state.timer ? '暂停' : '继续';
    folio.ui.set('timer', {
      type: 'stack',
      children: [
        { type: 'metric', value: clock(state.remaining || total), label },
        { type: 'progress', value: done, label: state.mode === 'idle' ? '' : '本轮进度 ' + done + '%' },
        { type: 'divider' },
        {
          type: 'row',
          children: [
            { type: 'button', text: primaryText, action: primary },
            { type: 'button', text: '结束', action: { id: 'reset' } },
          ],
        },
        { type: 'label', text: '今天' },
        { type: 'text', text: state.sessions + ' 轮完成 · 每轮 ' + focusMinutes() + ' 分钟' },
        { type: 'text', text: '一轮结束会提醒你休息 ' + breakMinutes() + ' 分钟。', tone: 'mono' },
      ],
    });
  };

  const finishFocus = () => {
    stopTimer();
    state.sessions += 1;
    saveSessions();
    state.mode = 'idle';
    state.remaining = 0;
    folio.notify('专注完成一轮，今天第 ' + state.sessions + ' 轮。');
    render();
    const rest = breakMinutes();
    if (!rest) return;
    state.mode = 'break';
    state.remaining = rest * 60;
    startTicking();
  };

  const finishBreak = () => {
    stopTimer();
    state.mode = 'idle';
    state.remaining = 0;
    folio.notify('休息结束，回来继续读吧。');
    render();
  };

  const tick = () => {
    state.remaining -= 1;
    if (state.remaining <= 0) {
      if (state.mode === 'focus') finishFocus();
      else finishBreak();
      return;
    }
    if (state.remaining % 5 === 0) render();
    else render();
  };

  function startTicking() {
    stopTimer();
    state.timer = setInterval(tick, 1000);
  }

  const start = () => {
    if (state.mode === 'idle') state.remaining = focusMinutes() * 60;
    state.mode = state.mode === 'idle' ? 'focus' : state.mode;
    startTicking();
    render();
    folio.ui.open('timer');
    return '已开始';
  };

  const pause = () => {
    stopTimer();
    render();
    return '已暂停';
  };

  const reset = () => {
    stopTimer();
    state.mode = 'idle';
    state.remaining = 0;
    render();
    return '已结束';
  };

  state.sessions = loadSessions();
  render();

  folio.commands.register('start', '开始专注', () => start());
  folio.commands.register('open', '打开计时器', () => {
    render();
    folio.ui.open('timer');
    return '已打开';
  });
  folio.commands.register('today', '今天读了几轮', () => {
    const total = state.sessions * focusMinutes();
    folio.notify('今天完成 ' + state.sessions + ' 轮，约 ' + total + ' 分钟。');
    return state.sessions;
  });

  folio.ui.onAction((action) => {
    if (action.id === 'start') return start();
    if (action.id === 'resume') return start();
    if (action.id === 'pause') return pause();
    if (action.id === 'reset') return reset();
    return null;
  });

  return () => {
    stopTimer();
    saveSessions();
  };
};
