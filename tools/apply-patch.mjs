// 编辑器在 Windows 上偶发 ReplaceFileW EIO：这里用「原文/新文」分块文件做精确替换。
// patch 文件用 LF 书写，目标文件是 CRLF 也能匹配（写完保持原换行风格）。
import fs from 'node:fs';

const patchPath = process.argv[2];
const raw = fs.readFileSync(patchPath, 'utf8').replace(/\r\n/g, '\n');
const lines = raw.split('\n');
let file = null;
const edits = [];
let mode = null;
let buf = [];
const flush = () => {
  if (!mode) return;
  edits.push({ kind: mode, text: buf.join('\n') });
  buf = [];
};
for (const line of lines) {
  if (line.startsWith('@@FILE ')) {
    flush();
    mode = null;
    file = line.slice(7).trim();
    continue;
  }
  if (line === '@@OLD' || line === '@@NEW') {
    flush();
    mode = line === '@@OLD' ? 'old' : 'new';
    continue;
  }
  if (line === '@@END') {
    flush();
    mode = null;
    continue;
  }
  buf.push(line);
}
flush();
if (!file) throw new Error('patch: missing @@FILE');
let text = fs.readFileSync(file, 'utf8');
const crlf = text.includes('\r\n');
if (crlf) text = text.replace(/\r\n/g, '\n');
const pairs = [];
for (let i = 0; i < edits.length; i += 2) {
  const oldText = edits[i];
  const newText = edits[i + 1];
  if (!oldText || oldText.kind !== 'old' || !newText || newText.kind !== 'new') {
    throw new Error(`patch: malformed pair at ${i}`);
  }
  pairs.push([oldText.text, newText.text]);
}
for (const [index, [oldText, newText]] of pairs.entries()) {
  const at = text.indexOf(oldText);
  if (at === -1) throw new Error(`patch: edit ${index} not found`);
  if (text.indexOf(oldText, at + 1) !== -1) throw new Error(`patch: edit ${index} ambiguous`);
  text = text.slice(0, at) + newText + text.slice(at + oldText.length);
}
if (crlf) text = text.replace(/\n/g, '\r\n');
fs.writeFileSync(file, text);
console.log(`patched ${file}: ${pairs.length} edit(s)`);
