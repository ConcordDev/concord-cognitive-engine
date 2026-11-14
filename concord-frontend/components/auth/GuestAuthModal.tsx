'use client';

/**
 * GuestAuthModal — GB-1536 §3b.
 *
 * The one signup/login modal a guest meets: from the Topbar buttons,
 * from a gated control, or from the API backstop when a guest action
 * was refused. It reuses AuthPage's form + OAuthButtons verbatim (no
 * third copy of the form) in AuthPage's embedded mode, and threads the
 * returnTo through it — after auth the browser hard-navigates to
 * exactly where the guest was.
 *
 * A11y contract (pinned by tests): role="dialog", aria-modal, labelled
 * by the form's own heading; focus moves into the dialog on open and
 * is trapped while it is open; Esc and the close button dismiss it
 * and focus returns to the triggering control (the provider restores
 * it). Works at 390px.
 */

import { useEffect, useRef } from 'react';
import { X } from 'lucide-react';
import { AuthPage } from './AuthPage';

interface GuestAuthModalProps {
  mode: 'signin' | 'signup';
  returnTo: string;
  onClose: () => void;
}

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function GuestAuthModal({ mode, returnTo, onClose }: GuestAuthModalProps) {
  const dialogRef = useRef<HTMLDivElement>(null);

  // Move focus into the dialog on open; trap Tab inside it; Esc closes.
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const first = dialog.querySelector<HTMLElement>(FOCUSABLE);
    (first ?? dialog).focus();

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key !== 'Tab') return;
      const items = Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
        (el) => !el.hasAttribute('disabled') && !el.closest('[hidden], [aria-hidden="true"]'),
      );
      if (items.length === 0) return;
      const firstEl = items[0];
      const lastEl = items[items.length - 1];
      if (e.shiftKey && document.activeElement === firstEl) {
        e.preventDefault();
        lastEl.focus();
      } else if (!e.shiftKey && document.activeElement === lastEl) {
        e.preventDefault();
        firstEl.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown, true);
    return () => document.removeEventListener('keydown', onKeyDown, true);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-[90] flex items-end justify-center bg-black/70 p-0 sm:items-center sm:p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="guest-auth-title"
        tabIndex={-1}
        className="relative max-h-[92vh] w-full max-w-md overflow-y-auto rounded-t-2xl bg-lattice-void shadow-2xl focus:outline-none sm:rounded-2xl"
        data-testid="guest-auth-modal"
      >
        <button
          type="button"
          onClick={onClose}
          aria-label="Close sign in"
          className="absolute right-3 top-3 z-10 rounded-lg p-2 text-gray-400 transition-colors hover:bg-white/5 hover:text-white"
        >
          <X className="h-5 w-5" />
        </button>
        <AuthPage embedded initialMode={mode} redirectTo={returnTo} />
      </div>
    </div>
  );
}
