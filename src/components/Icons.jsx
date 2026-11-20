/**
 * 图标：全部来自 lucide-react（ISC），不再自绘 SVG。
 *
 * 保持原有导出名与 `size` 默认值，调用点零改动；
 * 统一 1.6 描边，视觉重量与旧手绘图标一致。
 */
import {
  ArrowLeft,
  BookOpen,
  Bookmark,
  ChevronRight,
  Cloud,
  Command,
  Database,
  FileText,
  Folder,
  Highlighter,
  LayoutGrid,
  Library,
  List,
  Maximize2,
  Pause,
  Play,
  Plus,
  RefreshCw,
  Search,
  Settings,
  Share2,
  Sparkles,
  SquareTerminal,
  Trash2,
  Type,
  X,
} from 'lucide-react';

const base = { strokeWidth: 1.6, 'aria-hidden': true, focusable: 'false' };

export function IconBook({ size = 20, ...rest }) {
  return <BookOpen size={size} {...base} {...rest} />;
}

export function IconPlus({ size = 20, ...rest }) {
  return <Plus size={size} {...base} {...rest} />;
}

export function IconSearch({ size = 18, ...rest }) {
  return <Search size={size} {...base} {...rest} />;
}

export function IconBookmark({ size = 18, ...rest }) {
  return <Bookmark size={size} {...base} {...rest} />;
}

export function IconHighlight({ size = 18, ...rest }) {
  return <Highlighter size={size} {...base} {...rest} />;
}

export function IconNote({ size = 18, ...rest }) {
  return <FileText size={size} {...base} {...rest} />;
}

export function IconTrash({ size = 18, ...rest }) {
  return <Trash2 size={size} {...base} {...rest} />;
}

export function IconArrowLeft({ size = 20, ...rest }) {
  return <ArrowLeft size={size} {...base} {...rest} />;
}

export function IconList({ size = 20, ...rest }) {
  return <List size={size} {...base} {...rest} />;
}

export function IconType({ size = 20, ...rest }) {
  return <Type size={size} {...base} {...rest} />;
}

export function IconPlay({ size = 18, ...rest }) {
  return <Play size={size} {...base} {...rest} />;
}

export function IconPause({ size = 18, ...rest }) {
  return <Pause size={size} {...base} {...rest} />;
}

export function IconMaximize({ size = 18, ...rest }) {
  return <Maximize2 size={size} {...base} {...rest} />;
}

export function IconX({ size = 18, ...rest }) {
  return <X size={size} {...base} {...rest} />;
}

export function IconChevron({ size = 16, ...rest }) {
  return <ChevronRight size={size} {...base} {...rest} />;
}

export function IconSparkle({ size = 18, ...rest }) {
  return <Sparkles size={size} {...base} {...rest} />;
}

export function IconCloud({ size = 18, ...rest }) {
  return <Cloud size={size} {...base} {...rest} />;
}

export function IconRefresh({ size = 18, ...rest }) {
  return <RefreshCw size={size} {...base} {...rest} />;
}

export function IconDatabase({ size = 18, ...rest }) {
  return <Database size={size} {...base} {...rest} />;
}

export function IconGrid({ size = 18, ...rest }) {
  return <LayoutGrid size={size} {...base} {...rest} />;
}

export function IconShare({ size = 18, ...rest }) {
  return <Share2 size={size} {...base} {...rest} />;
}

export function IconCommand({ size = 18, ...rest }) {
  return <Command size={size} {...base} {...rest} />;
}

export function IconTerminal({ size = 18, ...rest }) {
  return <SquareTerminal size={size} {...base} {...rest} />;
}

export function IconSettings({ size = 18, ...rest }) {
  return <Settings size={size} {...base} {...rest} />;
}

export function IconBooks({ size = 20, ...rest }) {
  return <Library size={size} {...base} {...rest} />;
}

export function IconFolder({ size = 20, ...rest }) {
  return <Folder size={size} {...base} {...rest} />;
}
