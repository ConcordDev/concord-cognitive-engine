/**
 * Z_INDEX — the single documented stacking-order scale for globally-mounted
 * `fixed`-position components (everything mounted once in
 * `components/shell/AppShell.tsx` and visible across every lens).
 *
 * Before this file existed, each component picked its own `z-*` Tailwind
 * class in isolation (some literal `z-40`/`z-50`, some `z-[60]`), so the
 * *relative* stacking order between them was an accident of whoever wrote
 * that component, not a deliberate decision. Two pairs collided outright
 * (`Toasts` vs `SyncIndicator` both `z-50`) and several more happened to
 * occupy the exact same screen coordinates, so z-index was the only thing
 * separating them — which is fragile (mount order in AppShell's JSX decides
 * the tiebreak) and, per the pairs below, isn't even a full fix: same-position
 * elements need a real layout answer (offset or precedence-based
 * repositioning), not just "paint on top."
 *
 * Use these named tiers instead of a bare number so a new global overlay is
 * placed deliberately relative to the existing ones. Import the constant and
 * apply it via an inline `style={{ zIndex: Z_INDEX.X }}` — NOT a Tailwind
 * `z-[...]` class — because Tailwind's JIT scanner only picks up literal
 * class strings in source; a template-interpolated class name silently
 * never gets generated. (This mirrors the existing inline-zIndex pattern
 * already used for fixed-position overlays under `components/world-lens/`
 * and `components/world/`.)
 *
 * Tiers, low → high:
 *
 *   GUIDE_PASSIVE (30)   — SystemGuidePanel (collapsed bulb + expanded rail).
 *                          Lowest-priority persistent chrome; everything else
 *                          in this scale should be reachable above it.
 *   STATUS (40)          — SystemStatus (OK pill + expanded panel), the
 *                          FirstWinWizard "Resume" pill. Always-on / resumable
 *                          helpers a user opted into; outrank the guide panel,
 *                          yield to real notifications and action-required
 *                          overlays.
 *   FIRST_WIN_PANEL (41) — FirstWinWizard's *expanded* card. One tick above
 *                          STATUS so it doesn't lose to its own collapsed-pill
 *                          sibling tier if both ever render in the same pass;
 *                          still yields to notifications/action-required.
 *   TOAST (50)           — Toasts (transient, auto-dismissing notifications).
 *   SYNC_STATUS (50)     — SyncIndicator (persistent connectivity/sync state).
 *                          Same tier as TOAST by design: neither should paint
 *                          over the other by z-index alone because they can
 *                          be visible at once and share bottom-right — see
 *                          the position-offset fix in Toasts.tsx, which shifts
 *                          the toast stack up when the sync indicator is
 *                          showing instead of relying on stacking order.
 *   INSTALL_PROMPT (50)  — InstallPrompt (bottom-center; different position
 *                          from the TOAST/SYNC_STATUS corner, so tying the
 *                          tier is harmless).
 *   CONNECTION_BANNER (50) — ConnectionStatus (top strip, backend-health banner).
 *   ACTION_REQUIRED (60) — OfflineFallback (top strip, browser-offline banner)
 *                          and CookieConsent (bottom-left, first-run consent
 *                          gate). Both are the "more urgent, user must act or
 *                          acknowledge" side of a pair that shares a corner
 *                          with a passive indicator (OfflineFallback vs
 *                          ConnectionStatus; CookieConsent vs SystemStatus).
 *                          Higher than STATUS/CONNECTION_BANNER so when both
 *                          happen to render in the same spot, precedence is
 *                          intentional, not incidental — but the real fix for
 *                          those two pairs is the reactive position offset in
 *                          ConnectionStatus.tsx / SystemStatus.tsx, not this
 *                          number alone.
 *   HELP (60)            — HelpButton launcher + panel. Deliberately tied
 *                          with ACTION_REQUIRED: help must always be reachable,
 *                          but it already lives at a distinct screen position
 *                          (bottom-20/32 right-4) so the tie is harmless.
 *   SKIP_LINK (100)       — the accessibility skip-to-content link in
 *                          AppShell.tsx. Must outrank everything else when
 *                          focused.
 */
export const Z_INDEX = {
  GUIDE_PASSIVE: 30,
  STATUS: 40,
  FIRST_WIN_PANEL: 41,
  TOAST: 50,
  SYNC_STATUS: 50,
  INSTALL_PROMPT: 50,
  CONNECTION_BANNER: 50,
  ACTION_REQUIRED: 60,
  HELP: 60,
  SKIP_LINK: 100,
} as const;

export type ZIndexTier = keyof typeof Z_INDEX;
