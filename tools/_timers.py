import io
p='electron/plugins.js'
s=io.open(p,encoding='utf-8',newline='').read()
crlf='\r\n' in s
text=s.replace('\r\n','\n')

text=text.replace("""    record.instance = null;
    record.api = null;
    record.running = false;
    record.uiOpen = '';
    pushUi();""",
"""    for (const timer of record.timers || []) {
      try { clearInterval(timer); clearTimeout(timer); } catch {}
    }
    if (record.timers) record.timers.clear();
    record.instance = null;
    record.api = null;
    record.running = false;
    record.uiOpen = '';
    pushUi();""")

text=text.replace("""    const sandboxConsole = logFor(record.id);
    const module = { exports: {} };
    const context = vm.createContext({""",
"""    const sandboxConsole = logFor(record.id);
    const module = { exports: {} };
    if (!record.timers) record.timers = new Set();
    const trackTimeout = (fn, ms, ...args) => {
      const id = setTimeout(() => {
        record.timers.delete(id);
        try { fn(...args); } catch (error) { logFor(record.id).warn('定时器出错：', error?.message || error); }
      }, ms);
      record.timers.add(id);
      return id;
    };
    const trackInterval = (fn, ms, ...args) => {
      const id = setInterval(() => {
        try { fn(...args); } catch (error) { logFor(record.id).warn('定时器出错：', error?.message || error); }
      }, ms);
      record.timers.add(id);
      return id;
    };
    const untrack = (id) => {
      record.timers.delete(id);
      clearTimeout(id);
      clearInterval(id);
    };
    const context = vm.createContext({""")

text=text.replace("""      setTimeout,
      clearTimeout,
      setInterval,
      clearInterval,
      JSON,""","""      setTimeout: trackTimeout,
      clearTimeout: untrack,
      setInterval: trackInterval,
      clearInterval: untrack,
      JSON,""")

if crlf: text=text.replace('\n','\r\n')
io.open(p,'w',encoding='utf-8',newline='').write(text)
print('timers patched')
