'use client';

import { useState, type ReactNode } from 'react';

/**
 * Two-step delete that stays armed until the user confirms or cancels.
 *
 * A 4s auto-dismiss raced the click: the in-row "Confirm delete?" control
 * reverted before it could be used (FIX-hvac-013 / FIX-hvac-001). This
 * control has no timer.
 */
export function StickyDeleteConfirm({
  armed: armedProp,
  onArm,
  onConfirm,
  onCancel,
  armLabel,
  confirmLabel = 'Confirm delete?',
  armAriaLabel = 'Delete',
  confirmAriaLabel = 'Confirm delete',
  cancelAriaLabel = 'Cancel delete',
  className,
  disabled = false,
}: {
  /** Omit to let the button keep its own armed state until confirm or cancel. */
  armed?: boolean;
  onArm?: () => void;
  onConfirm: () => void;
  onCancel?: () => void;
  armLabel?: ReactNode;
  confirmLabel?: string;
  armAriaLabel?: string;
  confirmAriaLabel?: string;
  cancelAriaLabel?: string;
  className?: string;
  disabled?: boolean;
}) {
  const [localArmed, setLocalArmed] = useState(false);
  const controlled = armedProp !== undefined;
  const armed = controlled ? armedProp : localArmed;
  const arm = () => {
    if (!controlled) setLocalArmed(true);
    onArm?.();
  };
  const cancel = () => {
    if (!controlled) setLocalArmed(false);
    onCancel?.();
  };
  const confirm = () => {
    if (!controlled) setLocalArmed(false);
    onConfirm();
  };
  if (!armed) {
    return (
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); arm(); }}
        className={className}
        aria-label={armAriaLabel}
        disabled={disabled}
      >
        {armLabel ?? 'Delete'}
      </button>
    );
  }
  return (
    <span className="inline-flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
      <button
        type="button"
        onClick={confirm}
        className="text-xs px-2 py-1 rounded bg-red-500/20 text-red-300"
        aria-label={confirmAriaLabel}
      >
        {confirmLabel}
      </button>
      <button
        type="button"
        onClick={cancel}
        className="text-xs px-2 py-1 rounded text-zinc-300 hover:bg-white/10"
        aria-label={cancelAriaLabel}
      >
        Cancel
      </button>
    </span>
  );
}
