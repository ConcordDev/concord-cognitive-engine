/**
 * H10 — the skip link shows a strong focus state, the main landing area and
 * the scrolling view-tab strip draw their focus ring INSET (an outer ring is
 * clipped by their overflow containers, so it read as "no focus indicator").
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const read = (f: string) => readFileSync(resolve(__dirname, '..', f), 'utf8');

describe('H10 focus visibility', () => {
  const shell = read('components/shell/AppShell.tsx');
  it('skip link is the first focusable in the shell and shows a ring when focused', () => {
    const skip = shell.indexOf('href="#main-content"');
    expect(skip).toBeGreaterThan(0);
    expect(shell.indexOf('<Sidebar />')).toBeGreaterThan(skip);
    expect(shell.indexOf('<Topbar')).toBeGreaterThan(skip);
    expect(shell).toContain('focus:not-sr-only');
    expect(shell).toContain('focus:ring-2 focus:ring-white');
  });
  it('#main-content draws an inset ring on keyboard focus', () => {
    expect(shell).toMatch(/id="main-content"[\s\S]{0,200}focus-visible:ring-inset focus-visible:ring-offset-0/);
  });
  it('view-tab buttons draw an inset ring', () => {
    expect(read('components/lens/NorthStarFrame.tsx')).toContain('focus-visible:ring-inset focus-visible:ring-offset-0');
  });
});
