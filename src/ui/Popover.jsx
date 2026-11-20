/**
 * Radix Popover 薄封装。
 *
 * 用法：`<Popover trigger={<button … />}>面板内容</Popover>`；
 * 受控时传 `open` / `onOpenChange`。
 */
import React from 'react';
import * as PopoverPrimitive from '@radix-ui/react-popover';

export function Popover({
  trigger,
  children,
  open,
  onOpenChange,
  align = 'end',
  sideOffset = 8,
  className = 'ui-popover',
}) {
  const content = (
    <PopoverPrimitive.Content className={className} align={align} sideOffset={sideOffset}>
      {children}
    </PopoverPrimitive.Content>
  );
  return (
    <PopoverPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <PopoverPrimitive.Trigger asChild>{trigger}</PopoverPrimitive.Trigger>
      <PopoverPrimitive.Portal>{content}</PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  );
}
