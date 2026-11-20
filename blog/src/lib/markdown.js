import { marked } from 'marked';

marked.setOptions({ gfm: true, breaks: true });

/** 后台是唯一作者，内容可信，直接渲染。 */
export function renderMarkdown(markdown) {
  return marked.parse(String(markdown || ''));
}

export function countChars(markdown) {
  return String(markdown || '').replace(/```[\s\S]*?```/g, ' ').replace(/\s/g, '').length;
}
