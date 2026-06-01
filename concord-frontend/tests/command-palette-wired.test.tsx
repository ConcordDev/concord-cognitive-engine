// Phase DA3 — Command palette wiring tests.
//
// The world-variant CommandPalette (`components/world/CommandPalette.tsx`) is now
// a thin re-export shim onto the canonical palette at
// `components/common/CommandPalette.tsx`. The previous lens-registry/WORLD_ACTIONS
// palette was a no-importer duplicate and was retired:
//   - Ctrl/Cmd+K binding, fuzzy scoring, and arrow-key nav now live in the
//     common palette.
//   - World run-mode start commands are no longer baked into the palette; the
//     `concordia:start-mode` CustomEvent is consumed by
//     `components/world/GameModesHotbarGroup.tsx`, and world-scoped keyboard
//     commands register via the `useLensCommand` hook from the world lens page.
// These assertions verify the behavior where it ACTUALLY lives now.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SHIM = path.resolve(__dirname, '..', 'components', 'world', 'CommandPalette.tsx');
const COMMON = path.resolve(__dirname, '..', 'components', 'common', 'CommandPalette.tsx');
const WORLD = path.resolve(__dirname, '..', 'app', 'lenses', 'world', 'page.tsx');
const HOTBAR = path.resolve(__dirname, '..', 'components', 'world', 'GameModesHotbarGroup.tsx');

describe('Phase DA3 — Command palette', () => {
  const shim = readFileSync(SHIM, 'utf8');
  const common = readFileSync(COMMON, 'utf8');

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

  it('wires run-mode start dispatches via the GameModesHotbarGroup', () => {
    // World run-mode entry uses the `concordia:start-mode` CustomEvent, which is
    // consumed by the hotbar group (the palette no longer bakes WORLD_ACTIONS in).
    const hotbar = readFileSync(HOTBAR, 'utf8');
    expect(hotbar).toMatch(/concordia:start-mode/);
    expect(hotbar).toMatch(/addEventListener\(\s*['"]concordia:start-mode['"]/);
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
