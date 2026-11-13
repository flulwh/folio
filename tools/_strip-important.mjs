// 一次性工具：剥离 apple.css 中的 !important，解除它对后续样式层的压制。
// 这些 !important 原本是为了压过 index.css 的旧规则；剥离后 apple.css 仍
// 靠「后加载 + 同特异性」获胜，行为基本等价，而新设计层得以正常覆盖。
import fs from 'node:fs';
import path from 'node:path';

const file = path.join(process.cwd(), 'src', 'apple.css');
const src = fs.readFileSync(file, 'utf8');
const count = (src.match(/!important/g) || []).length;

// 只删 !important 标记本身，保留其前的一个空格以免破坏声明格式
const out = src.replace(/\s*!important/g, '');

fs.writeFileSync(file, out);
console.log(`apple.css: removed ${count} !important, ${src.length} -> ${out.length} bytes`);

// 校验
const left = (out.match(/!important/g) || []).length;
console.log('remaining !important:', left);
