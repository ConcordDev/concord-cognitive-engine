/**
 * H1 — translucent dark surfaces (bg-zinc-900/60, bg-zinc-950/40, ...) flip
 * under the Light theme like their opaque siblings.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect } from 'vitest';

const css = readFileSync(resolve(__dirname, '../app/globals.css'), 'utf8');
const has = (sel: string, decl: string) => {
  const i = css.indexOf(sel);
  return i >= 0 && css.slice(i, i + sel.length + 160).includes(decl);
};

describe('H1 light theme translucent surfaces', () => {
  it.each([
    ['.light .bg-zinc-900\\/60', 'rgb(244 244 245 / 0.6)'],
    ['.light .bg-zinc-950\\/40', 'rgb(250 250 250 / 0.4)'],
    ['.light .bg-zinc-800\\/60', 'rgb(228 228 231 / 0.6)'],
    ['.light .bg-gray-900\\/60', 'rgb(244 244 245 / 0.6)'],
    ['.light .bg-slate-950\\/50', 'rgb(250 250 250 / 0.5)'],
  ])('%s flips', (sel, decl) => {
    expect(has(sel, decl)).toBe(true);
  });

  it('in-flow bg-black/40 tints lightly but scrims stay dark', () => {
    expect(css).toContain('.light .bg-black\\/40:not(.fixed):not(.absolute)');
    expect(css).not.toMatch(/\.light \.bg-black\\\/40 \{/);
  });
});
