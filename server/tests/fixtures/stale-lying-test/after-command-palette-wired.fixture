// Phase DA3 — Command palette wiring tests.
//
// The world-variant CommandPalette (`components/world/CommandPalette.tsx`) is now
// a thin re-export shim onto the canonical palette at
// `components/common/CommandPalette.tsx`. The previous lens-registry/WORLD_ACTIONS
// palette was a no-importer duplicate and was retired:
//   - Ctrl/Cmd+K binding, fuzzy scoring, and arrow-key nav now live in the
//     common palette.
//   - World run-mode start commands ARE baked into the common palette (Fix 7,
//     verification audit, 2026-07-05) as 6 `mode:<id>` pseudo-entries that
//     dispatch the same `concordia:start-mode` CustomEvent
//     `components/world/GameModesHotbarGroup.tsx` already listens for.
//     World-scoped keyboard commands additionally register via the
//     `useLensCommand` hook from the world lens page.
// These assertions verify the behavior where it ACTUALLY lives now.
//
// The "wires run-mode start dispatches" test below used to only regex-match
// that both files *mentioned* the event name/listener — it would have passed
// even if the palette never dispatched anything (which was, in fact, the
// real bug the verification audit found: nothing dispatched
// `concordia:start-mode` before Fix 7). It's now a real render + interaction
// test: render the actual CommandPalette, select a mode entry, and assert
// `window.dispatchEvent` fires the correct CustomEvent.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SHIM = path.resolve(__dirname, '..', 'components', 'world', 'CommandPalette.tsx');
const COMMON = path.resolve(__dirname, '..', 'components', 'common', 'CommandPalette.tsx');
const WORLD = path.resolve(__dirname, '..', 'app', 'lenses', 'world', 'page.tsx');

// Mock scrollIntoView which jsdom doesn't implement (CommandPalette scrolls
// the selected option into view on every ArrowUp/ArrowDown).
Element.prototype.scrollIntoView = vi.fn();

const mockPush = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: mockPush,
    back: vi.fn(),
    forward: vi.fn(),
    refresh: vi.fn(),
    replace: vi.fn(),
    prefetch: vi.fn(),
  }),
}));

import { CommandPalette } from '@/components/common/CommandPalette';
import { GameModesHotbarGroup } from '@/components/world/GameModesHotbarGroup';

describe('Phase DA3 — Command palette', () => {
  const shim = readFileSync(SHIM, 'utf8');
  const common = readFileSync(COMMON, 'utf8');

  beforeEach(() => {
    mockPush.mockClear();
  });

  afterEach(() => {
    cleanup();
  });

  it('world palette re-exports the canonical common palette', () => {
    // The world variant is a shim that delegates to the common palette.
    expect(shim).toMatch(/export\s*\{\s*CommandPalette[\s\S]*\}\s*from\s*['"]@\/components\/common\/CommandPalette['"]/);
  });

  it('binds Ctrl+K and Cmd+K', () => {
    expect(common).toMatch(/e\.metaKey\s*\|\|\s*e\.ctrlKey/);
    expect(common).toMatch(/e\.key\s*===\s*['"]k['"]/);
  });

  it('reads lenses from the canonical lens-registry', () => {
    // No longer lazy-loaded; the palette imports the registry directly and
    // builds its command list from getCommandPaletteLenses().
    expect(common).toMatch(/from\s*['"]@\/lib\/lens-registry['"]/);
    expect(common).toMatch(/getCommandPaletteLenses\(\)/);
  });

  it('dispatches concordia:start-mode with the right mode when a run-mode entry is chosen', () => {
    const dispatchSpy = vi.spyOn(window, 'dispatchEvent');
    render(<CommandPalette isOpen={true} onClose={vi.fn()} />);

    const input = screen.getByRole('combobox');
    // Filter down to the single "Horde" run-mode entry (the palette also has
    // an unrelated "Horde" content lens name collision risk — filter by the
    // "Start Mode —" prefix baked into every mode entry's display name).
    fireEvent.change(input, { target: { value: 'Start Mode — Horde' } });
    const option = screen.getByText('Start Mode — Horde').closest('button');
    expect(option).toBeTruthy();
    fireEvent.click(option!);

    // Real behavioral assertion: the palette itself fired the event, not just
    // "some file somewhere mentions the string".
    const calls = dispatchSpy.mock.calls.filter(([evt]) => (evt as Event).type === 'concordia:start-mode');
    expect(calls).toHaveLength(1);
    const dispatched = calls[0][0] as CustomEvent<{ mode: string }>;
    expect(dispatched.detail).toEqual({ mode: 'horde' });

    // The router must NOT have been used for a mode entry — it dispatches
    // instead of navigating away from the world lens.
    expect(mockPush).not.toHaveBeenCalled();
    dispatchSpy.mockRestore();
  });

  it('the dispatched concordia:start-mode event actually opens GameModesHotbarGroup\'s confirm modal for the chosen mode', () => {
    // End-to-end proof: render the REAL consumer alongside the palette and
    // confirm the dispatched event drives its UI, not just that both files
    // independently reference the same string.
    render(<GameModesHotbarGroup worldId="test-world" />);
    render(<CommandPalette isOpen={true} onClose={vi.fn()} />);

    const input = screen.getByRole('combobox');
    fireEvent.change(input, { target: { value: 'Start Mode — Brawl' } });
    const option = screen.getByText('Start Mode — Brawl').closest('button');
    fireEvent.click(option!);

    // GameModesHotbarGroup's confirm modal should now be open for Brawl.
    // (Both the palette and the hotbar's confirm modal use role="dialog",
    // so assert on the hotbar-specific heading text rather than the role,
    // which would now match two elements.)
    expect(screen.getByText('Start Brawl?')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Start Brawl$/ })).toBeInTheDocument();
  });

  it('has a fuzzy-match scorer over name + keywords + description', () => {
    expect(common).toMatch(/fuzzyScore/);
    expect(common).toMatch(/scoreLens/);
    // Subsequence-in-order matching is the documented fuzzy strategy.
    expect(common).toMatch(/in order/i);
  });

  it('supports arrow-key navigation + enter to run', () => {
    expect(common).toMatch(/ArrowDown/);
    expect(common).toMatch(/ArrowUp/);
    expect(common).toMatch(/case\s+['"]Enter['"]/);
  });

  it('mounted in world lens', () => {
    const w = readFileSync(WORLD, 'utf8');
    expect(w).toMatch(/CommandPalette/);
    expect(w).toMatch(/<CommandPalette \/>/);
  });
});
