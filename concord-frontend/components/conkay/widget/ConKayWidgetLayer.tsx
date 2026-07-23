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
// Later units attach here, not inside ConKayWidget:
//   - CK2 will replace the hardcoded `state="idle"` default below with one
//     derived from a real macro/brain-lifecycle subscription (mirroring
//     `conkayHudStore.ts`'s single-writer pattern), and may layer
//     turn-toward-user behavior into `onActivate`.
//   - CK3 will replace the static `top-16 right-4` position below with a
//     safe-region-solver-driven walk target.

import { useCallback, useEffect, useState } from 'react';
import { ConKayWidget, type ConKayWidgetState } from './ConKayWidget';
import { Z_INDEX } from '@/lib/ui/z-index';

/** localStorage key for the user's "hide the ConKay widget" preference. */
export const CONKAY_WIDGET_HIDDEN_KEY = 'concord:conkay-widget-hidden';

export interface ConKayWidgetLayerProps {
  /**
   * Real system state to render (see ConKayWidget's honesty contract).
   * Defaults to 'idle' — CK1 ships no state-producing wiring yet; that's
   * CK2's job.
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

export function ConKayWidgetLayer({ state = 'idle', onActivate }: ConKayWidgetLayerProps) {
  // Start visible during SSR/first client render (matches ConKayWidget's
  // server-rendered markup with no localStorage access), then reconcile the
  // real persisted preference in an effect — the same hydration-safe shape
  // AppShell already uses for its own `mounted` flag.
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    setHidden(readHidden());
  }, []);

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
    window.dispatchEvent(new Event('conkay:summon'));
  }, [onActivate]);

  if (hidden) return null;

  return (
    <div style={{ zIndex: Z_INDEX.STATUS }} className="fixed top-16 right-4 md:top-20 md:right-6">
      <ConKayWidget state={state} onActivate={activate} onDismiss={dismiss} />
    </div>
  );
}

export default ConKayWidgetLayer;
