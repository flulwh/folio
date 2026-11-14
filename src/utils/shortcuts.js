/** 全局快捷键说明：快捷键面板与设置页共用同一份数据。 */
const isMac = typeof navigator !== 'undefined' && /mac/i.test(navigator.userAgent);
const mod = isMac ? '⌘' : 'Ctrl';

export { isMac, mod };

export const SHORTCUT_GROUPS = [
  {
    title: '全局',
    items: [
      ['?', '打开 / 关闭快捷键说明'],
      ['Esc', '关闭弹窗、返回上一级'],
    ],
  },
  {
    title: '书架',
    items: [
      ['/', '搜索书名'],
      [`${mod} + O`, '导入 TXT / Markdown'],
      ['拖拽文件', '导入到书架'],
    ],
  },
  {
    title: '阅读',
    items: [
      ['← / →', '上一章 / 下一章'],
      ['↑ / ↓', '上下滚动'],
      ['Space / PgUp / PgDn', '翻页'],
      ['Home / End', '回到开头 / 跳到末尾'],
      ['T', '打开目录'],
      ['S', '阅读设置'],
      [`${mod} + F`, '全书搜索'],
      ['B', '当前段落加 / 取消书签'],
      ['M', '书签与笔记'],
      ['A', '自动滚动'],
      ['F', '全屏'],
      ['Esc', '返回书架'],
    ],
  },
  {
    title: '漫画',
    items: [
      ['← / →', '上一章 / 下一章'],
      ['T', '打开目录'],
      ['Home / End', '回到顶部 / 跳到末尾'],
      ['+ / −', '放大 / 缩小'],
      ['F', '切换「适应宽度 / 原始尺寸」'],
      ['Esc', '关闭图片 / 收起工具栏 / 返回'],
    ],
  },
  {
    title: '书籍市场',
    items: [
      ['Enter', '搜索'],
      ['/', '聚焦搜索框'],
      ['Esc', '返回书架'],
    ],
  },
];
