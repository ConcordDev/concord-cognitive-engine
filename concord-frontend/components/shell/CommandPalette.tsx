'use client';

/**
 * Re-export shim. The canonical CommandPalette lives at
 * `@/components/common/CommandPalette`. This file remains so existing
 * `@/components/shell/CommandPalette` imports keep resolving — the
 * common version supports both controlled (isOpen / onClose) and
 * UI-store-driven modes.
 */

export { CommandPalette, type CommandPaletteProps } from '@/components/common/CommandPalette';
