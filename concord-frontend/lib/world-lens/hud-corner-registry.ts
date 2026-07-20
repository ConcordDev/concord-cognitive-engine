/**
 * World Lens plan Phase 6b — deterministic corner-stacking for the
 * page.tsx-anchored HUD chrome. Before this, every corner-anchored panel
 * hardcoded its own Tailwind offset (`top-4`, `top-32`, `bottom-24`, ...)
 * guessed by eye at the time it was added — which is how the fullscreen/
 * pointer-lock toggle bar and the HP/Stamina resource bars ended up both
 * mounted at the literal `absolute top-4 left-4`, and the theme picker and
 * camera-mode controls both at `absolute top-4 right-4` (confirmed live by
 * grep, not assumed — two genuine, currently-shipping visual collisions).
 *
 * This registry is a single declared list instead of N independently
 * guessed magic numbers: each entry claims a `corner` + `order` (stacking
 * priority within that corner, edge-closest first) + `sizePx` (the space
 * to reserve along the stacking axis). `hudCornerOffsetPx(id)` sums the
 * sizes+gaps of every lower-order entry in the same corner to produce the
 * one number each mount site needs (the offset from its near edge) —
 * everything else about the element's className (z-index, background,
 * the perpendicular edge inset, cosmetic styling) is untouched.
 *
 * Deliberately NOT a full flow-layout/DOM-measurement system (e.g. a
 * ResizeObserver-driven flexbox stack) — that's real engineering beyond
 * the "small" scope this phase calls for. `sizePx` is a conservative
 * static estimate of each element's COLLAPSED height; a panel that
 * expands past its reserved slot (e.g. CameraControls, which is taller
 * once a camera mode's full controls render) can still overlap the next
 * slot in rare states — the same imprecision the old hand-typed `top-32`
 * had, just now derived and adjustable in one place instead of copy-
 * pasted as an opaque magic number at each call site.
 */

export type HudCorner = 'top-left' | 'top-right' | 'top-center' | 'bottom-left' | 'bottom-right' | 'bottom-center';

export interface HudCornerSlot {
  /** Stable identifier — pass this to hudCornerOffsetPx(). */
  id: string;
  corner: HudCorner;
  /** Stacking priority within the corner. Lower = closer to the screen edge. */
  order: number;
  /** Conservative estimate of this element's collapsed size (px) along the stacking axis (height for top/bottom corners). */
  sizePx: number;
  /** Gap reserved after this slot, before the next one. Defaults to DEFAULT_GAP_PX. */
  gapPx?: number;
}

/** Matches Tailwind's `-4` (1rem) edge inset every one of these mounts already used. */
export const HUD_EDGE_INSET_PX = 16;
export const HUD_DEFAULT_GAP_PX = 8;

/**
 * Per-corner base inset override, for a corner where something OUTSIDE
 * this registry already occupies space near the edge. `bottom-right`
 * carries the one real case: `HUDOverlay` (`components/world-lens/
 * HUDOverlay.tsx`) renders its own internally-positioned fixed bottom
 * bar across the screen, which is why the quest tracker's original
 * hardcoded offset was `bottom-24` (96px) rather than the plain `bottom-4`
 * (16px) every other corner used — preserved here exactly rather than
 * re-derived, since HUDOverlay's own height isn't a registry concern.
 */
const HUD_CORNER_BASE_INSET_PX: Partial<Record<HudCorner, number>> = {
  'bottom-right': 96,
};

// Add a new corner-anchored HUD element here — not a new hardcoded
// `top-N`/`bottom-N` Tailwind class at the call site.
export const HUD_CORNER_SLOTS: readonly HudCornerSlot[] = Object.freeze([
  { id: 'fullscreen-toggle', corner: 'top-left', order: 0, sizePx: 40 },
  { id: 'resource-bars', corner: 'top-left', order: 1, sizePx: 64 },

  { id: 'theme-picker', corner: 'top-right', order: 0, sizePx: 40 },
  { id: 'camera-controls', corner: 'top-right', order: 1, sizePx: 48 },
  { id: 'run-mode-hotbar', corner: 'top-right', order: 2, sizePx: 40 },

  { id: 'season-banner', corner: 'top-center', order: 0, sizePx: 32 },

  { id: 'gameplay-toolbar', corner: 'bottom-center', order: 0, sizePx: 48 },

  { id: 'quest-tracker', corner: 'bottom-right', order: 0, sizePx: 96 },
]);

/** true for corners whose stacking axis grows downward from the top edge. */
function stacksFromTop(corner: HudCorner): boolean {
  return corner === 'top-left' || corner === 'top-right' || corner === 'top-center';
}

/**
 * Offset (px) from the corner's near horizontal edge (top for top-*
 * corners, bottom for bottom-* corners) for the given registered slot id.
 * Returns HUD_EDGE_INSET_PX (the plain, unstacked default) for an
 * unregistered id rather than throwing — a not-yet-registered element
 * degrades to "as if it's alone in its corner," never a crash.
 */
export function hudCornerOffsetPx(id: string): number {
  const slot = HUD_CORNER_SLOTS.find((s) => s.id === id);
  if (!slot) return HUD_EDGE_INSET_PX;
  const baseInset = HUD_CORNER_BASE_INSET_PX[slot.corner] ?? HUD_EDGE_INSET_PX;
  return HUD_CORNER_SLOTS
    .filter((s) => s.corner === slot.corner && s.order < slot.order)
    .reduce((sum, s) => sum + s.sizePx + (s.gapPx ?? HUD_DEFAULT_GAP_PX), baseInset);
}

/**
 * Convenience wrapper returning the inline `style` prop for a registered
 * slot: `{ top: N }` for top-stacking corners, `{ bottom: N }` otherwise.
 * The perpendicular axis (left/right inset, or the `left-1/2
 * -translate-x-1/2` centering transform) stays as a Tailwind class at the
 * call site — every slot in a given corner shares the same one, so it
 * never needs to be registry-derived.
 */
export function hudCornerStyle(id: string): { top: number } | { bottom: number } {
  const slot = HUD_CORNER_SLOTS.find((s) => s.id === id);
  const offset = hudCornerOffsetPx(id);
  const corner = slot?.corner;
  return corner && !stacksFromTop(corner) ? { bottom: offset } : { top: offset };
}
