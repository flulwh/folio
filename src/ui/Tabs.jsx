/**
 * Radix Tabs 薄封装。
 *
 * 只负责「选中态 + 键盘 + aria」，样式由 primitives.css 的 `.ui-tabs*` 提供；
 * 需要滑动拇指的分段控件（Segmented）不要用这里，那个保留自己的弹簧测量。
 */
import React from 'react';
import * as TabsPrimitive from '@radix-ui/react-tabs';

export function Tabs({ value, defaultValue, onValueChange, children, className }) {
  return (
    <TabsPrimitive.Root
      value={value}
      defaultValue={defaultValue}
      onValueChange={onValueChange}
      className={className}
    >
      {children}
    </TabsPrimitive.Root>
  );
}

export function TabsList({ children, className = 'ui-tabs-list', ariaLabel }) {
  return (
    <TabsPrimitive.List className={className} aria-label={ariaLabel}>
      {children}
    </TabsPrimitive.List>
  );
}

export function TabsTrigger({ value, children, className = 'ui-tab' }) {
  return (
    <TabsPrimitive.Trigger value={value} className={className}>
      {children}
    </TabsPrimitive.Trigger>
  );
}

export function TabsContent({ value, children, className }) {
  return (
    <TabsPrimitive.Content value={value} className={className}>
      {children}
    </TabsPrimitive.Content>
  );
}
