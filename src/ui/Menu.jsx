/**
 * 菜单：右键菜单与「更多」下拉。
 *
 * item 形状：{ label, onSelect, disabled?, danger?, icon?, type?: 'sep' | 'label' }
 * 外观走 primitives.css 的 `.ui-menu*`，颜色仍取 tokens。
 */
import React from 'react';
import * as ContextMenuPrimitive from '@radix-ui/react-context-menu';
import * as DropdownMenuPrimitive from '@radix-ui/react-dropdown-menu';

function renderItems(items, primitives) {
  const { Item, Separator, Label } = primitives;
  return items.map((item, index) => {
    const key = item.key ?? `${item.type || 'item'}-${item.label || index}`;
    if (item.type === 'sep') return <Separator key={key} className="ui-menu-sep" />;
    if (item.type === 'label') {
      return (
        <Label key={key} className="ui-menu-label">
          {item.label}
        </Label>
      );
    }
    return (
      <Item
        key={key}
        className={`ui-menu-item${item.danger ? ' danger' : ''}`}
        disabled={item.disabled}
        onSelect={(event) => {
          event.preventDefault();
          item.onSelect?.();
        }}
      >
        {item.icon ? <span className="ui-menu-icon">{item.icon}</span> : null}
        <span>{item.label}</span>
      </Item>
    );
  });
}

/** 给一块区域加右键菜单（替换手写 role="menu"）。 */
export function ContextMenuArea({ children, items, ariaLabel = '操作' }) {
  return (
    <ContextMenuPrimitive.Root>
      <ContextMenuPrimitive.Trigger asChild>{children}</ContextMenuPrimitive.Trigger>
      <ContextMenuPrimitive.Portal>
        <ContextMenuPrimitive.Content className="ui-menu" aria-label={ariaLabel}>
          {renderItems(items, {
            Item: ContextMenuPrimitive.Item,
            Separator: ContextMenuPrimitive.Separator,
            Label: ContextMenuPrimitive.Label,
          })}
        </ContextMenuPrimitive.Content>
      </ContextMenuPrimitive.Portal>
    </ContextMenuPrimitive.Root>
  );
}

/** 「更多」下拉：trigger 需是单个可聚焦元素。 */
export function Dropdown({ trigger, items, align = 'end', ariaLabel = '更多操作' }) {
  return (
    <DropdownMenuPrimitive.Root>
      <DropdownMenuPrimitive.Trigger asChild>{trigger}</DropdownMenuPrimitive.Trigger>
      <DropdownMenuPrimitive.Portal>
        <DropdownMenuPrimitive.Content className="ui-menu" align={align} sideOffset={6} aria-label={ariaLabel}>
          {renderItems(items, {
            Item: DropdownMenuPrimitive.Item,
            Separator: DropdownMenuPrimitive.Separator,
            Label: DropdownMenuPrimitive.Label,
          })}
        </DropdownMenuPrimitive.Content>
      </DropdownMenuPrimitive.Portal>
    </DropdownMenuPrimitive.Root>
  );
}
