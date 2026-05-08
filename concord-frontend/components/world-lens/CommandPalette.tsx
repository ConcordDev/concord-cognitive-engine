'use client';

/**
 * Re-export shim. The canonical CommandPalette lives at
 * `@/components/common/CommandPalette`. The world-lens variant now
 * delegates to the common one — world-only commands should be
 * registered via the `useLensCommand` hook from inside the world lens
 * page rather than baked into a duplicate palette implementation.
 */

export { CommandPalette, type CommandPaletteProps } from '@/components/common/CommandPalette';
