/**
 * Lightweight custom-window-event names used to coordinate layout between
 * globally-mounted `fixed`-position overlays that share a screen corner (see
 * `lib/ui/z-index.ts` for the full stacking-order rationale).
 *
 * These exist so two sibling components can react to each other's visibility
 * without a shared store slice or importing one another directly — mirrors
 * the existing `FIRST_RUN_ADVANCE` event in `lib/first-run.ts`.
 */

/**
 * Dispatched by `components/pwa/SyncIndicator.tsx` whenever its own visibility
 * (offline, or a pending sync queue) changes. `components/common/Toasts.tsx`
 * listens for this to shift the toast stack up instead of letting it sit
 * exactly on top of the persistent sync/connectivity indicator in the same
 * bottom-right corner.
 */
export const SYNC_INDICATOR_VISIBILITY_EVENT = 'concord:sync-indicator-visibility';
