// CommandPaletteCtrlKField.test.tsx
//
// FIX-energy-004 premise check: focusing the Energy lens's Watts input
// and pressing Ctrl+K opened the lens-search palette, stealing the
// keystroke from the field. The palette's global listener (and the
// useGlobalShortcuts binding) now yield via shouldIgnoreLensHotkey —
// a fix that landed during the sweep (2026-11-11) before this slice
// was cut. This pin drives the REAL uncontrolled palette: Ctrl+K from
// inside a focused field must not open it; Ctrl+K from the page body
// must.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import React from 'react';

Element.prototype.scrollIntoView = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), back: vi.fn(), forward: vi.fn(), refresh: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
}));
vi.mock('@/lib/lens-registry', () => ({
  getCommandPaletteLenses: () => [],
  getParentCoreLens: () => null,
  getCoreLensConfig: () => null,
  LENS_CATEGORIES: { core: { label: 'Core' }, governance: { label: 'Governance' }, system: { label: 'System' }, world: { label: 'World' } },
}));
vi.mock('@/lib/panel-registry', () => ({ allPanels: () => [] }));
vi.mock('@/lib/panel-dispatcher', () => ({ openPanel: vi.fn() }));
vi.mock('@/components/world/concordia-hud/HUDContextProvider', () => ({ useHUDContext: () => null }));
vi.mock('lucide-react', () => {
  const createIcon = (name: string) => {
    const Component = (props: Record<string, unknown>) => React.createElement('span', { 'data-testid': `icon-${name}`, ...props });
    Component.displayName = name;
    return Component;
  };
  return {
    Search: createIcon('Search'), CornerDownLeft: createIcon('CornerDownLeft'), ArrowUp: createIcon('ArrowUp'),
    ArrowDown: createIcon('ArrowDown'), Sparkles: createIcon('Sparkles'), LayoutPanelLeft: createIcon('LayoutPanelLeft'),
    Dice5: createIcon('Dice5'), Zap: createIcon('Zap'), Crosshair: createIcon('Crosshair'), Ghost: createIcon('Ghost'),
    Hourglass: createIcon('Hourglass'), Swords: createIcon('Swords'), Skull: createIcon('Skull'), Wrench: createIcon('Wrench'),
    ScrollText: createIcon('ScrollText'), Ruler: createIcon('Ruler'), Layers: createIcon('Layers'), Radar: createIcon('Radar'),
    Coins: createIcon('Coins'), Eye: createIcon('Eye'), Link2: createIcon('Link2'),
  };
});
vi.mock('framer-motion', () => ({
  motion: {
    div: ({ children, ...p }: Record<string, unknown>) => React.createElement('div', p, children as React.ReactNode),
  },
  AnimatePresence: ({ children }: { children?: React.ReactNode }) => React.createElement(React.Fragment, null, children),
}));

import { CommandPalette } from '@/components/common/CommandPalette';
import { useUIStore } from '@/store/ui';

describe('Ctrl+K from a form field (FIX-energy-004 premise)', () => {
  beforeEach(() => {
    useUIStore.setState({ commandPaletteOpen: false });
  });
  afterEach(() => cleanup());

  it('does not open from the Watts input; opens from the page body', () => {
    render(
      React.createElement('div', null,
        React.createElement('input', { 'aria-label': 'Watts now', defaultValue: '' }),
        React.createElement(CommandPalette, {}),
      ),
    );
    const watts = screen.getByLabelText('Watts now') as HTMLInputElement;
    watts.focus();
    expect(document.activeElement).toBe(watts);

    fireEvent.keyDown(watts, { key: 'k', ctrlKey: true });
    expect(useUIStore.getState().commandPaletteOpen).toBe(false);

    watts.blur();
    fireEvent.keyDown(document.body, { key: 'k', ctrlKey: true });
    expect(useUIStore.getState().commandPaletteOpen).toBe(true);
  });
});
