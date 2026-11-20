/**
 * Radix Dialog / AlertDialog 的薄封装。
 *
 * 行为（焦点圈、Esc、遮罩点击、aria）交给 Radix；外观仍是现有皮肤类：
 *  - `Modal`   居中弹窗，内容类名默认沿用面板样式；
 *  - `Sheet`   贴边抽屉，内容通常传 `panel settings-panel` 这类现有类；
 *  - `Confirm` 二次确认（删除书、清空进度）。
 *
 * 退场动画由一层 AnimatePresence + forceMount 控制，禁止再在调用处包第二层。
 */
import React, { useRef } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import * as AlertDialogPrimitive from '@radix-ui/react-alert-dialog';
import { useMotionKit } from '../design/motion.js';

function Overlay({ className, kit, children }) {
  return (
    <motion.div
      className={className}
      variants={kit.backdrop}
      initial="initial"
      animate="animate"
      exit="exit"
    >
      {children}
    </motion.div>
  );
}

export function Modal({
  open,
  onOpenChange,
  children,
  className = 'ui-confirm',
  backdropClassName = 'modal-backdrop',
  ariaLabel,
  initialFocusRef,
}) {
  const kit = useMotionKit();
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <AnimatePresence>
        {open && (
          <DialogPrimitive.Portal forceMount>
            <div className="ui-dialog-layer">
              <DialogPrimitive.Overlay asChild forceMount>
                <Overlay className={backdropClassName} kit={kit} />
              </DialogPrimitive.Overlay>
              <DialogPrimitive.Content
                asChild
                forceMount
                aria-label={ariaLabel}
                aria-describedby={undefined}
                onOpenAutoFocus={(event) => {
                  if (!initialFocusRef?.current) return;
                  event.preventDefault();
                  initialFocusRef.current.focus();
                }}
              >
                <motion.div
                  className={className}
                  variants={kit.modal}
                  initial="initial"
                  animate="animate"
                  exit="exit"
                >
                  {children}
                </motion.div>
              </DialogPrimitive.Content>
            </div>
          </DialogPrimitive.Portal>
        )}
      </AnimatePresence>
    </DialogPrimitive.Root>
  );
}

export function Sheet({
  open,
  onOpenChange,
  side = 'right',
  children,
  className,
  backdropClassName = 'panel-backdrop',
  ariaLabel,
  initialFocusRef,
}) {
  const kit = useMotionKit();
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <AnimatePresence>
        {open && (
          <DialogPrimitive.Portal forceMount>
            <div className="ui-dialog-layer">
              <DialogPrimitive.Overlay asChild forceMount>
                <Overlay className={backdropClassName} kit={kit} />
              </DialogPrimitive.Overlay>
              <DialogPrimitive.Content
                asChild
                forceMount
                aria-label={ariaLabel}
                aria-describedby={undefined}
                onOpenAutoFocus={(event) => {
                  if (!initialFocusRef?.current) return;
                  event.preventDefault();
                  initialFocusRef.current.focus();
                }}
              >
                <motion.aside
                  className={className}
                  variants={kit.sheet(side)}
                  initial="initial"
                  animate="animate"
                  exit="exit"
                >
                  {children}
                </motion.aside>
              </DialogPrimitive.Content>
            </div>
          </DialogPrimitive.Portal>
        )}
      </AnimatePresence>
    </DialogPrimitive.Root>
  );
}

/**
 * 二次确认。`danger` 为 true 时确认按钮用现有 `.btn.primary` 的危险态。
 *
 * 受控用法：父组件用 `<Confirm open onOpenChange … />`，确认后由父组件关闭。
 */
export function Confirm({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel = '确定',
  cancelLabel = '取消',
  danger = false,
  onConfirm,
}) {
  const kit = useMotionKit();
  const confirmRef = useRef(null);
  return (
    <AlertDialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <AnimatePresence>
        {open && (
          <AlertDialogPrimitive.Portal forceMount>
            <div className="ui-dialog-layer">
              <AlertDialogPrimitive.Overlay asChild forceMount>
                <Overlay className="modal-backdrop" kit={kit} />
              </AlertDialogPrimitive.Overlay>
              <AlertDialogPrimitive.Content
                asChild
                forceMount
                onOpenAutoFocus={(event) => {
                  event.preventDefault();
                  confirmRef.current?.focus();
                }}
              >
                <motion.div
                  className="ui-confirm"
                  variants={kit.modal}
                  initial="initial"
                  animate="animate"
                  exit="exit"
                >
                  <AlertDialogPrimitive.Title className="ui-confirm-title">
                    {title}
                  </AlertDialogPrimitive.Title>
                  {description ? (
                    <AlertDialogPrimitive.Description className="ui-confirm-desc">
                      {description}
                    </AlertDialogPrimitive.Description>
                  ) : null}
                  <div className="ui-confirm-actions">
                    <AlertDialogPrimitive.Cancel asChild>
                      <button className="btn ghost small">{cancelLabel}</button>
                    </AlertDialogPrimitive.Cancel>
                    <AlertDialogPrimitive.Action asChild>
                      <button
                        ref={confirmRef}
                        className="btn primary small"
                        style={danger ? { background: '#b4544a' } : undefined}
                        onClick={() => onConfirm?.()}
                      >
                        {confirmLabel}
                      </button>
                    </AlertDialogPrimitive.Action>
                  </div>
                </motion.div>
              </AlertDialogPrimitive.Content>
            </div>
          </AlertDialogPrimitive.Portal>
        )}
      </AnimatePresence>
    </AlertDialogPrimitive.Root>
  );
}
