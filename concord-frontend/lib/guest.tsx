'use client';

/**
 * Guest mode — GB-1536 "Enter means Enter".
 *
 * The middleware sets x-concord-guest (stripping any inbound copy) on
 * signed-out requests to /hub and /lenses/*; the root layout turns it
 * into GuestProvider so the shell and lens views know from the first
 * render that this is a read-only visit: no fake account, no server
 * session — just a flag.
 *
 * GuestAuthProvider hosts the ONE signup/login modal. Anything that
 * needs it — the Topbar buttons, a GuestGate'd control, the API
 * client's backstop (via lib/guest-bridge) — opens it through the
 * same path, and the triggering control gets focus back on close.
 */

import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import { setGuestMode, registerGuestAuthOpener } from './guest-bridge';
import { currentReturnTo, validateReturnTo } from './return-to';
import { stashDraft, takeDraft } from './draft-stash';

export { GUEST_HEADER } from './guest-constants';

const GuestContext = createContext(false);

export function GuestProvider({ value, children }: { value: boolean; children: React.ReactNode }) {
  useEffect(() => {
    setGuestMode(value);
    return () => setGuestMode(false);
  }, [value]);
  return <GuestContext.Provider value={value}>{children}</GuestContext.Provider>;
}

/** True when this page was served to a signed-out visitor in guest mode. */
export function useGuest(): boolean {
  return useContext(GuestContext);
}

// ── The auth modal host ───────────────────────────────────────────────

const GuestAuthModal = dynamic(
  () => import('@/components/auth/GuestAuthModal').then((m) => m.GuestAuthModal),
  { ssr: false },
);

interface GuestAuthState {
  open: boolean;
  mode: 'signin' | 'signup';
  returnTo: string;
}

const GuestAuthContext = createContext<{
  openAuth: (mode?: 'signin' | 'signup', returnTo?: string) => void;
}>({ openAuth: () => {} });

export function GuestAuthProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<GuestAuthState>({ open: false, mode: 'signup', returnTo: '/hub' });
  const lastTriggerRef = useRef<HTMLElement | null>(null);

  const openAuth = useCallback((mode: 'signin' | 'signup' = 'signup', returnTo?: string) => {
    if (typeof document !== 'undefined' && document.activeElement instanceof HTMLElement) {
      lastTriggerRef.current = document.activeElement;
    }
    setState({ open: true, mode, returnTo: validateReturnTo(returnTo ?? currentReturnTo()) });
  }, []);

  const closeAuth = useCallback(() => {
    setState((s) => ({ ...s, open: false }));
    // Esc/close returns focus to the triggering control.
    const trigger = lastTriggerRef.current;
    if (trigger && typeof trigger.focus === 'function') {
      requestAnimationFrame(() => trigger.focus());
    }
  }, []);

  // The API client's backstop opens the modal through the bridge.
  useEffect(() => {
    registerGuestAuthOpener((returnTo) => openAuth('signup', returnTo));
    return () => registerGuestAuthOpener(null);
  }, [openAuth]);

  return (
    <GuestAuthContext.Provider value={{ openAuth }}>
      {children}
      {state.open && (
        <GuestAuthModal
          mode={state.mode}
          returnTo={state.returnTo}
          onClose={closeAuth}
        />
      )}
    </GuestAuthContext.Provider>
  );
}

export function useGuestAuth(): { openAuth: (mode?: 'signin' | 'signup', returnTo?: string) => void } {
  return useContext(GuestAuthContext);
}

// ── Acting as a guest: gate once, not per lens ────────────────────────

/**
 * useGuestAction — run `fn` when signed in; when a guest, stash the
 * intent's draft (never the action) and open the signup modal.
 * Returns true when the action ran.
 */
export function useGuestAction(): (
  fn: () => void,
  opts?: { draft?: Record<string, string>; returnTo?: string },
) => boolean {
  const guest = useGuest();
  const { openAuth } = useGuestAuth();
  return useCallback(
    (fn, opts) => {
      if (!guest) {
        fn();
        return true;
      }
      const returnTo = validateReturnTo(opts?.returnTo ?? currentReturnTo());
      if (opts?.draft && Object.keys(opts.draft).length > 0) {
        stashDraft(returnTo, opts.draft);
      }
      openAuth('signup', returnTo);
      return false;
    },
    [guest, openAuth],
  );
}

/**
 * GuestGate — wraps a mutating control. For a guest, the control stays
 * visible and enabled-looking; activating it captures the named form
 * fields inside the gate as the intent draft, opens the signup modal,
 * and the wrapped action never fires. For a signed-in user it is
 * transparent.
 */
export function GuestGate({
  children,
  draft,
  className,
}: {
  children: React.ReactNode;
  /** Explicit draft snapshot; default: capture named inputs inside the gate. */
  draft?: () => Record<string, string>;
  className?: string;
}) {
  const guest = useGuest();
  const { openAuth } = useGuestAuth();
  const ref = useRef<HTMLSpanElement>(null);

  if (!guest) return <>{children}</>;

  const captureAndOpen = (e: React.SyntheticEvent) => {
    e.preventDefault();
    e.stopPropagation();
    let fields: Record<string, string> | undefined;
    if (draft) {
      fields = draft();
    } else if (ref.current) {
      fields = {};
      ref.current
        .querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>('input[name], textarea[name], select[name]')
        .forEach((el) => {
          if (el.name) fields![el.name] = el.value;
        });
    }
    const returnTo = currentReturnTo();
    if (fields && Object.keys(fields).length > 0) stashDraft(returnTo, fields);
    openAuth('signup', returnTo);
  };

  return (
    <span
      ref={ref}
      className={className}
      onClickCapture={captureAndOpen}
      onSubmitCapture={captureAndOpen}
    >
      {children}
    </span>
  );
}

/**
 * useRestoredDraft — after auth, the page the user landed back on
 * reads the intent draft stashed for this exact returnTo (path +
 * search + hash). Consumed on first read; expired drafts read as null.
 * NEVER auto-submit anything with it — it restores fields only.
 */
export function useRestoredDraft(): Record<string, string> | null {
  const guest = useGuest();
  const [fields, setFields] = useState<Record<string, string> | null>(null);
  useEffect(() => {
    // Only a signed-in page consumes the stash — a guest re-mount must
    // not eat the draft that is waiting for the post-auth landing.
    if (guest) return;
    setFields(takeDraft(currentReturnTo()));
  }, [guest]);
  return fields;
}
