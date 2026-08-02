'use client';

// concord-frontend/components/conkay/widget/ConKayWidgetLayer.tsx
//
// ConKayWidgetLayer — the single mount point for <ConKayWidget />.
//
// Owns exactly the two things `ConKayWidget` itself must not own (see that
// file's header honesty contract): (1) the user's dismissed/hidden
// preference, persisted to localStorage so a dismissal survives reload, and
// (2) fixed-position placement above lens content, chosen to avoid the
// app's other always-on fixed chrome.
//
// Position note (checked against every other globally-mounted fixed
// component in AppShell.tsx, via lib/ui/z-index.ts's own collision writeup):
// the bottom-left corner is already shared by SystemStatus + FirstWinWizard's
// collapsed pill + CookieConsent; the bottom-right corner is already shared
// by HelpButton + SyncIndicator + InstallPrompt + ConKayOverlay's own
// "closed" summon button (`fixed bottom-6 right-6 z-[55]` in
// ConKayOverlay.tsx, deliberately left untouched — see that file's header).
// MobileNav additionally claims the ENTIRE bottom strip on small screens
// (`fixed bottom-0 left-0 right-0`). The only corner nothing else in
// AppShell currently occupies is top-right, below the Topbar's sticky
// 56px/64px strip — that's where this mounts (`top-16 right-4` mobile,
// `md:top-20 md:right-6` desktop), clear of the fixed left Sidebar (`w-16`
// collapsed / `w-64` expanded) entirely. Reuses `Z_INDEX.STATUS` (the
// "always-on, user-opted-in helper" tier already defined in
// lib/ui/z-index.ts) rather than inventing a new tier.
//
// Default `onActivate` dispatches the SAME `window` CustomEvent
// (`'conkay:summon'`) that CommandPalette's "Summon Kay" entry and
// ConKayOverlay's own hotkey/summon-event listener already use to open the
// full overlay (see ConKayOverlay.tsx's `onSummon` subscription and
// lib/panel-dispatcher.ts's doc comment on the same event name) — this
// reuses the EXISTING open contract instead of reaching into ConKayOverlay's
// internals, per the CK1 unit's non-negotiable ("do NOT touch ConKayOverlay
// internals — only add a hook point").
//
// CK2: `state` now defaults to a REAL derived value read from
// `conkayAttentionStore.ts` (`useConKayWidgetState()`) instead of a
// hardcoded 'idle' — that store's ONLY writer is ConKayOverlay's own
// open/busy/voice lifecycle effects, mirroring booleans it already tracks
// for itself (see that store's header for the exact honesty contract). A
// caller may still pass an explicit `state` prop to override (e.g. a test,
// or a future unit with a different real source) — the store-derived value
// is only the default.
//
// Later units attach here, not inside ConKayWidget:
//   - CK3 (SHIPPED, narrower than originally staged — see
//     `useConkayOccluded.ts`'s header for why): rather than walking to an
//     alternate free corner (an audit found none — every corner besides
//     this one is already a documented real occupant per z-index.ts), this
//     layer now hides the widget while a REAL, currently-mounted element
//     (SystemGuidePanel's expanded rail / PersistentChatRail's expanded
//     rail / AchievementToast's toast stack) is genuinely covering this
//     exact spot, detected via `data-conkay-occludes-top-right` DOM
//     markers + a MutationObserver (no polling).
//   - CK4 (SHIPPED): this layer now owns `useConkayInitiativePoll` (the
//     single writer for `conkayInitiativeStore.ts`) and threads the real
//     pending count into `ConKayWidget`'s `pendingCount` prop. Polling is
//     gated OFF while the widget is `hidden` or the full overlay is
//     `open` — no point polling a signal the user can't currently see the
//     badge for, and the overlay itself is a much richer surface once open.

import { useCallback, useEffect, useState } from 'react';
import { ConKayWidget, type ConKayWidgetState } from './ConKayWidget';
import { useConKayWidgetState, useConkayAttentionStore } from '../conkayAttentionStore';
import { useConkayInitiativePoll, useConkayInitiativeStore } from '../conkayInitiativeStore';
import { useConkayOccluded } from './useConkayOccluded';
import { Z_INDEX } from '@/lib/ui/z-index';

/** localStorage key for the user's "hide the ConKay widget" preference. */
export const CONKAY_WIDGET_HIDDEN_KEY = 'concord:conkay-widget-hidden';

export interface ConKayWidgetLayerProps {
  /**
   * Real system state to render (see ConKayWidget's honesty contract).
   * Omit to use the REAL state derived from `conkayAttentionStore.ts` (the
   * default, and what every real mount should do) — pass an explicit value
   * only to override it (tests, or a future alternate real source).
   */
  state?: ConKayWidgetState;
  /**
   * Override the default `'conkay:summon'` event dispatch — e.g. for a test,
   * or a future unit that wants a different promote path. Most callers
   * should omit this and get the existing ConKayOverlay open contract.
   */
  onActivate?: () => void;
}

function readHidden(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.localStorage.getItem(CONKAY_WIDGET_HIDDEN_KEY) === 'true';
  } catch {
    // Private-mode/storage-disabled — default to visible rather than throw.
    return false;
  }
}

export function ConKayWidgetLayer({ state, onActivate }: ConKayWidgetLayerProps) {
  // The real, store-derived state (see conkayAttentionStore.ts) — used
  // whenever the caller doesn't explicitly override `state`. Reading the
  // hook unconditionally keeps the hook-call order stable regardless of
  // whether a caller passes `state`.
  const derivedState = useConKayWidgetState();
  const effectiveState = state ?? derivedState;
  // Real, store-derived "is the full overlay currently open" flag (the same
  // `open` boolean ConKayOverlay's own lifecycle effect mirrors into this
  // store — see conkayAttentionStore.ts's header). Used below so clicking the
  // ambient widget toggles rather than only ever re-summoning an
  // already-open overlay.
  const overlayOpen = useConkayAttentionStore((s) => s.open);

  // Start visible during SSR/first client render (matches ConKayWidget's
  // server-rendered markup with no localStorage access), then reconcile the
  // real persisted preference in an effect — the same hydration-safe shape
  // AppShell already uses for its own `mounted` flag.
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    setHidden(readHidden());
  }, []);

  // CK4: poll the real initiative feed only while there's a point — the
  // widget is visible and the full overlay isn't already open (which has
  // its own, richer surfaces for this). See conkayInitiativeStore.ts for
  // why this reuses InitiativeBell.tsx's exact endpoint rather than
  // inventing anything.
  useConkayInitiativePoll(!hidden && !overlayOpen);
  const pendingCount = useConkayInitiativeStore((s) => s.pending.length);

  // CK3: real occlusion check — see useConkayOccluded.ts for why this
  // hides rather than relocates.
  const occluded = useConkayOccluded();

  const dismiss = useCallback(() => {
    setHidden(true);
    try {
      window.localStorage.setItem(CONKAY_WIDGET_HIDDEN_KEY, 'true');
    } catch {
      // Private-mode/storage-disabled — the in-memory hide still applies for
      // this session even though it won't survive reload.
    }
  }, []);

  const activate = useCallback(() => {
    if (onActivate) {
      onActivate();
      return;
    }
    // Toggle: if the full overlay is already open (real state mirrored from
    // ConKayOverlay itself, not guessed), a second click on the ambient
    // widget dismisses it via the existing `conkay:dismiss` window-event
    // contract ConKayOverlay already listens for; otherwise summon as before.
    window.dispatchEvent(new Event(overlayOpen ? 'conkay:dismiss' : 'conkay:summon'));
  }, [onActivate, overlayOpen]);

  if (hidden || occluded) return null;

  return (
    <div style={{ zIndex: Z_INDEX.STATUS }} className="fixed top-16 right-4 md:top-20 md:right-6">
      <ConKayWidget state={effectiveState} onActivate={activate} onDismiss={dismiss} pendingCount={pendingCount} />
    </div>
  );
}

export default ConKayWidgetLayer;
