'use client';

/**
 * Re-export shim. The canonical CommandPalette lives at
 * `@/components/common/CommandPalette`. This world variant was a duplicate
 * lens-registry palette with no importers; it now delegates to the common one
 * (which supports both controlled `isOpen`/`onClose` and UI-store-driven modes).
 * World-only commands register via the `useLensCommand` hook from inside the
 * world lens page, not a baked-in duplicate palette.
 *
 * (Distinct surfaces are intentionally NOT shimmed: `components/all` runs a
 * runtime macro command-index, and `components/world/concordia-hud` is a
 * HUD-scoped palette — those are different features, not duplicates.)
 */

export { CommandPalette, type CommandPaletteProps } from '@/components/common/CommandPalette';
