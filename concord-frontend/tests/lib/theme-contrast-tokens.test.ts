/**
 * Light theme used to invert text-white to near-black while lattice
 * utilities stayed a compiled dark hex (RCA-contrast-theme-tokens).
 * Lattice utilities now read RGB channels that flip with .light, and
 * text inside a bg-black island stays light.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect } from 'vitest';
import { contrastRatio } from '@/lib/social/contrast';

const root = resolve(__dirname, '../..');
const css = readFileSync(resolve(root, 'app/globals.css'), 'utf8');
const tw = readFileSync(resolve(root, 'tailwind.config.js'), 'utf8');

function channel(block: string, name: string): string {
  const match = new RegExp(`--${name}-rgb:\\s*([0-9]+\\s+[0-9]+\\s+[0-9]+)\\s*;`).exec(block);
  if (!match) throw new Error(`missing --${name}-rgb`);
  const [r, g, b] = match[1].split(/\s+/).map((n) => Number(n).toString(16).padStart(2, '0'));
  return `#${r}${g}${b}`;
}

function sliceBetween(source: string, start: string, end: string): string {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from + start.length);
  if (from < 0 || to < 0) throw new Error(`missing slice ${start}`);
  return source.slice(from, to);
}

describe('theme contrast tokens', () => {
  const dark = sliceBetween(css, 'Lattice Empire Theme - Dark', 'Neon Accents');
  const light = sliceBetween(css, '/* Light Mode */', '@layer base');

  it('points every lattice utility at a theme RGB channel', () => {
    for (const name of ['void', 'deep', 'surface', 'elevated', 'border', 'bg', 'base', 'edge', 'text']) {
      expect(tw).toContain(`rgb(var(--lattice-${name}-rgb) / <alpha-value>)`);
      expect(dark).toContain(`--lattice-${name}-rgb:`);
      expect(light).toContain(`--lattice-${name}-rgb:`);
    }
  });

  it('light-mode lattice text clears AA on the light lattice surface', () => {
    const text = channel(light, 'lattice-text');
    const surface = channel(light, 'lattice-void');
    const ratio = contrastRatio(text, surface);
    expect(ratio).not.toBeNull();
    expect(ratio!).toBeGreaterThanOrEqual(4.5);
  });

  it('dark-mode lattice text clears AA on the dark lattice surface', () => {
    const text = channel(dark, 'lattice-text');
    const surface = channel(dark, 'lattice-void');
    const ratio = contrastRatio(text, surface);
    expect(ratio).not.toBeNull();
    expect(ratio!).toBeGreaterThanOrEqual(4.5);
  });

  it('keeps light text on the dark bg-black island', () => {
    expect(css).toContain('.light .bg-black .text-white, .light .bg-black.text-white { color: #fafafa; }');
    const ratio = contrastRatio('#fafafa', '#18181b');
    expect(ratio).not.toBeNull();
    expect(ratio!).toBeGreaterThanOrEqual(4.5);
  });
});
