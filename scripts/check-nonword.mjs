import { compilePattern } from '../electron/replace.js';

const cases = [
  { pattern: '[\\W]+', isRegex: true, input: '中文ABC，。' },
  { pattern: '\\W+', isRegex: true, input: '中文ABC，。' },
  { pattern: '[\\w]+', isRegex: true, input: '中文ABC，。' },
];

for (const item of cases) {
  const re = compilePattern(item.pattern, item.isRegex);
  console.log(JSON.stringify(item.pattern), '->', re.source, '=>', JSON.stringify(item.input.replace(re, '#')));
}
