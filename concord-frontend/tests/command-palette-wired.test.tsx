// Phase DA3 — Command palette wiring tests.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PAL = path.resolve(__dirname, '..', 'components', 'world', 'CommandPalette.tsx');
const WORLD = path.resolve(__dirname, '..', 'app', 'lenses', 'world', 'page.tsx');

describe('Phase DA3 — Command palette', () => {
  const src = readFileSync(PAL, 'utf8');

  it('binds Ctrl+K and Cmd+K', () => {
    expect(src).toMatch(/ctrlKey\s*\|\|\s*e\.metaKey/);
    expect(src).toMatch(/['"]k['"]/);
  });

  it('lazy-loads lens-registry', () => {
    expect(src).toMatch(/import\(['"]@\/lib\/lens-registry['"]/);
  });

  it('includes WORLD_ACTIONS for start-mode dispatches', () => {
    expect(src).toMatch(/WORLD_ACTIONS/);
    expect(src).toMatch(/concordia:start-mode/);
  });

  it('has fuzzy-match scorer', () => {
    expect(src).toMatch(/fuzzyMatch/);
    expect(src).toMatch(/subsequence/i);
  });

  it('supports arrow-key navigation + enter to run', () => {
    expect(src).toMatch(/ArrowDown/);
    expect(src).toMatch(/ArrowUp/);
    expect(src).toMatch(/Enter/);
  });

  it('mounted in world lens', () => {
    const w = readFileSync(WORLD, 'utf8');
    expect(w).toMatch(/CommandPalette/);
    expect(w).toMatch(/<CommandPalette \/>/);
  });
});
