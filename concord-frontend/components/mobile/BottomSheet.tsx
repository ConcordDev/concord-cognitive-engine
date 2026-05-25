'use client';

/**
 * BottomSheet — modal bottom drawer with drag-to-dismiss, designed for
 * touch devices. Drop-in replacement for desktop side-panel modals on
 * narrow viewports.
 *
 * Phase 5 of the UX completeness sprint (mobile track).
 *
 * Touch contract:
 *   - Drag down past 80px → dismiss.
 *   - Drag down 0-80px → spring-back.
 *   - Backdrop click → dismiss.
 *   - ESC key → dismiss (keyboard parity).
 *
 * No fake animation — uses transform translations + native CSS
 * transitions so framer-motion isn't a dependency.
 */

import { useEffect, useRef, useState, ReactNode } from 'react';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface BottomSheetProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  /** Initial height as % of viewport. Default 60. */
  initialPercent?: number;
  /** Max height as % of viewport. Default 90. */
  maxPercent?: number;
  /** Snap points (sorted ascending %). Default [40, 60, 90]. */
  snaps?: number[];
  children: ReactNode;
  className?: string;
}

const DISMISS_THRESHOLD_PX = 80;

export function BottomSheet({
  open, onClose, title, initialPercent = 60, maxPercent = 90,
  snaps = [40, 60, 90], children, className,
}: BottomSheetProps) {
  const [translateY, setTranslateY] = useState(0);
  const [activeSnap, setActiveSnap] = useState(initialPercent);
  const startYRef = useRef<number | null>(null);
  const draggingRef = useRef(false);
  const sheetRef = useRef<HTMLDivElement | null>(null);

  // ESC to dismiss.
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, onClose]);

  useEffect(() => {
    if (open) {
      setTranslateY(0);
      setActiveSnap(initialPercent);
    }
  }, [open, initialPercent]);

  const onTouchStart = (e: React.TouchEvent) => {
    startYRef.current = e.touches[0].clientY;
    draggingRef.current = true;
  };

  const onTouchMove = (e: React.TouchEvent) => {
    if (!draggingRef.current || startYRef.current === null) return;
    const dy = e.touches[0].clientY - startYRef.current;
    setTranslateY(Math.max(0, dy));
  };

  const onTouchEnd = () => {
    draggingRef.current = false;
    if (translateY >= DISMISS_THRESHOLD_PX) {
      onClose();
    } else {
      setTranslateY(0);
    }
  };

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col justify-end"
      aria-modal="true"
      role="dialog"
    >
      <button
        type="button"
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
        aria-label="Close"
      />
      <div
        ref={sheetRef}
        className={cn(
          'relative bg-zinc-950 border-t border-zinc-800 rounded-t-2xl shadow-2xl',
          'flex flex-col overflow-hidden transition-transform duration-200',
          className,
        )}
        style={{
          height: `${activeSnap}vh`,
          maxHeight: `${maxPercent}vh`,
          transform: `translateY(${translateY}px)`,
          transition: draggingRef.current ? 'none' : 'transform 200ms ease-out',
        }}
      >
        {/* Drag handle */}
        <div
          className="flex-none flex items-center justify-center pt-3 pb-1 select-none touch-none"
          onTouchStart={onTouchStart}
          onTouchMove={onTouchMove}
          onTouchEnd={onTouchEnd}
        >
          <div className="w-12 h-1.5 rounded-full bg-zinc-700" />
        </div>

        {/* Header */}
        {(title || true) && (
          <header className="flex items-center justify-between px-4 py-2 border-b border-zinc-800/60">
            <h3 className="text-sm font-medium text-zinc-100">{title}</h3>
            <div className="flex items-center gap-1">
              {snaps.map(s => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setActiveSnap(s)}
                  className={cn(
                    'text-[10px] font-mono px-1.5 py-0.5 rounded',
                    activeSnap === s ? 'bg-zinc-800 text-zinc-100' : 'text-zinc-400 hover:text-zinc-300',
                  )}
                  aria-label={`Snap to ${s}%`}
                >
                  {s}%
                </button>
              ))}
              <button
                type="button"
                onClick={onClose}
                className="ml-1 text-zinc-400 hover:text-zinc-200 p-1"
                aria-label="Close sheet"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </header>
        )}

        {/* Body */}
        <div className="flex-1 overflow-y-auto">
          {children}
        </div>
      </div>
    </div>
  );
}

export default BottomSheet;
