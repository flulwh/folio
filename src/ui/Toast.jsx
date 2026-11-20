/**
 * Toast：队列与无障碍交给 sonner，外观沿用现有 `.toast` 皮肤。
 *
 * 数据源仍是 AppStore 的 `notify(message, tone, options)` 单条状态；
 * `ToastBridge` 把状态变化映射成 sonner 的自定义 toast，调用方零改动。
 * 一次只显示最新一条：新提示到达时先撤掉上一条，避免排队堆积。
 */
import React, { useEffect, useRef } from 'react';
import { Toaster as SonnerToaster, toast as sonner } from 'sonner';
import { useAppActions, useToast } from '../store/AppStore.jsx';

function ToastCard({ item, onDismiss }) {
  return (
    <div className={`toast ${item.tone || 'info'}`}>
      <span className="toast-dot" aria-hidden="true" />
      <span className="toast-text">{item.message}</span>
      {item.action?.label && (
        <button
          className="toast-action"
          onClick={() => {
            onDismiss?.();
            try {
              item.action.onClick?.();
            } catch (err) {
              console.error('toast action failed', err);
            }
          }}
        >
          {item.action.label}
        </button>
      )}
      <button className="toast-close" onClick={onDismiss} title="关闭提示" aria-label="关闭提示">
        ×
      </button>
    </div>
  );
}

export function Toaster() {
  return (
    <SonnerToaster
      position="bottom-center"
      offset={24}
      visibleToasts={1}
      gap={8}
      closeButton={false}
      toastOptions={{ unstyled: true, className: 'toast-host' }}
    />
  );
}

export function ToastBridge() {
  const item = useToast();
  const { dismissToast } = useAppActions();
  const currentId = useRef(null);

  useEffect(() => {
    if (!item || item.id === currentId.current) return;
    if (currentId.current) sonner.dismiss(`folio-${currentId.current}`);
    currentId.current = item.id;
    sonner.custom(
      () => (
        <ToastCard
          item={item}
          onDismiss={() => {
            sonner.dismiss(`folio-${item.id}`);
            dismissToast();
          }}
        />
      ),
      {
        id: `folio-${item.id}`,
        duration: item.tone === 'error' ? 4600 : 2600,
        onDismiss: () => dismissToast(),
      },
    );
  }, [item, dismissToast]);

  return null;
}
