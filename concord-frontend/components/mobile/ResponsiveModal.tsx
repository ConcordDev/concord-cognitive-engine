'use client';

/**
 * ResponsiveModal — drop-in wrapper that picks between a centered
 * desktop modal and a BottomSheet on touch viewports.
 *
 * Phase 5 mobile track (UX completeness sprint). Saves every modal
 * mount from re-implementing the viewport branch.
 *
 * Usage:
 *   <ResponsiveModal open={open} onClose={close} title="New record">
 *     <YourForm />
 *   </ResponsiveModal>
 *
 * Mobile: full-width bottom sheet, drag to dismiss, ESC parity.
 * Desktop: centered modal, backdrop click + ESC dismiss.
 */

import { ReactNode, useEffect } from 'react';
import { X } from 'lucide-react';
import { BottomSheet } from './BottomSheet';
import { useViewport } from '@/hooks/useViewport';
import { cn } from '@/lib/utils';

export interface ResponsiveModalProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: ReactNode;
  /** Initial bottom-sheet height % (mobile only). Default 70. */
  mobileInitialPercent?: number;
  /** Max desktop-modal width tailwind class. Default 'max-w-2xl'. */
  desktopMaxWidth?: string;
  className?: string;
}

export function ResponsiveModal({
  open, onClose, title, children,
  mobileInitialPercent = 70, desktopMaxWidth = 'max-w-2xl', className,
}: ResponsiveModalProps) {
  const { isMobile, isTouch } = useViewport();
  const useSheet = isMobile || isTouch;

  // ESC dismiss on desktop branch (BottomSheet handles it for mobile).
  useEffect(() => {
    if (useSheet || !open) return;
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [useSheet, open, onClose]);

  if (!open) return null;

  if (useSheet) {
    return (
      <BottomSheet open={open} onClose={onClose} title={title} initialPercent={mobileInitialPercent} className={className}>
        {children}
      </BottomSheet>
    );
  }

  // Desktop modal.
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" aria-modal="true" role="dialog">
      <button
        type="button"
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
        aria-label="Close"
      />
      <div className={cn('relative w-full bg-zinc-950 border border-zinc-800 rounded-xl shadow-2xl overflow-hidden flex flex-col max-h-[85vh]', desktopMaxWidth, className)}>
        {title && (
          <header className="flex items-center justify-between px-4 py-3 border-b border-zinc-800/60">
            <h3 className="text-sm font-medium text-zinc-100">{title}</h3>
            <button
              type="button"
              onClick={onClose}
              className="text-zinc-400 hover:text-zinc-200 p-1"
              aria-label="Close"
            >
              <X className="w-4 h-4" />
            </button>
          </header>
        )}
        <div className="flex-1 overflow-y-auto">
          {children}
        </div>
      </div>
    </div>
  );
}

export default ResponsiveModal;
