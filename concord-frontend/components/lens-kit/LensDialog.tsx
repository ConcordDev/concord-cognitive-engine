'use client';

/**
 * LensDialog — a dialog the app's one keyboard listener already understands.
 *
 * `lib/a11y/overlay-keyboard.ts` closes the top overlay on Escape by activating its
 * Close control and keeps Tab inside an aria-modal dialog (the fix for the walk's
 * largest root cause, RCA-escape-focus-trap). This dialog is built to that contract:
 * role="dialog", aria-modal, a labelled title, and a button named "Close" marked
 * data-overlay-close. It moves focus inside when it opens and gives it back to what
 * opened it when it closes. Full-screen sheet on a phone, centred card above.
 */

import { useEffect, useId, useRef, type ReactNode } from 'react';
import { cn } from '@/lib/utils';

export function LensDialog({ open, onClose, title, children, footer, className }: { open: boolean; onClose: () => void; title: string; children: ReactNode; footer?: ReactNode; className?: string }) {
  const titleId = useId();
  const panel = useRef<HTMLDivElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (!open) return;
    opener.current = (document.activeElement as HTMLElement) || null;
    const first = panel.current?.querySelector<HTMLElement>('[autofocus], input, select, textarea, button:not([data-overlay-close]), [href], [tabindex]:not([tabindex="-1"])');
    (first || panel.current)?.focus();
    return () => { opener.current?.focus?.(); };
  }, [open]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 sm:items-center" data-testid="lens-dialog-backdrop"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div ref={panel} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1}
        className={cn('flex max-h-[100dvh] w-full min-w-0 flex-col overflow-hidden bg-[color:var(--lk-surface-raised,#fff)] text-[color:var(--lk-text,#171717)] shadow-xl sm:max-h-[85vh] sm:max-w-lg sm:rounded-xl', className)}>
        <div className="flex min-w-0 items-center justify-between gap-2 border-b border-[color:var(--lk-line,#e5e5e5)] px-4 py-3">
          <h2 id={titleId} className="min-w-0 truncate text-base font-semibold">{title}</h2>
          <button type="button" data-overlay-close onClick={onClose} className="min-h-[44px] min-w-[44px] rounded-md px-2 text-sm hover:bg-[color:var(--lk-line,#e5e5e5)] focus-visible:outline focus-visible:outline-2">Close</button>
        </div>
        <div className="min-w-0 flex-1 overflow-y-auto px-4 py-3">{children}</div>
        {footer ? <div className="flex min-w-0 flex-wrap justify-end gap-2 border-t border-[color:var(--lk-line,#e5e5e5)] px-4 py-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))]">{footer}</div> : null}
      </div>
    </div>
  );
}
