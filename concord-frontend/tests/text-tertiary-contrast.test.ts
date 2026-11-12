/**
 * FIX (CB-0434 theme-7 contrast section): the shared tertiary text token
 * must meet WCAG AA for normal text (4.5:1) on every dark background
 * layer it renders on. Before the fix, --text-tertiary was #79746c —
 * 4.21:1 on --bg-base, 3.97:1 on --bg-surface, 3.66:1 on --bg-raised —
 * and the hardcoded fallback in the shared lens components was #5C584F
 * (2.4–2.8:1). Both failed AA at every layer, which is the shared cause
 * under the audit's muted-text contrast tickets (RCA-contrast-theme-tokens).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function luminance(hex: string): number {
  const c = hex.replace('#', '');
  const f = (i: number) => {
    const v = parseInt(c.substr(i, 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * f(0) + 0.7152 * f(2) + 0.0722 * f(4);
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

function token(css: string, name: string): string {
  const m = css.match(new RegExp(`${name}:\\s*(#[0-9a-fA-F]{6})`));
  if (!m) throw new Error(`token ${name} not found in globals.css`);
  return m[1];
}

describe('shared tertiary text token contrast (CB-0434)', () => {
  const css = readFileSync(path.join(root, 'app/globals.css'), 'utf8');
  const tertiary = token(css, '--text-tertiary');
  const layers: Array<[string, string]> = [
    ['--bg-base', token(css, '--bg-base')],
    ['--bg-surface', token(css, '--bg-surface')],
    ['--bg-raised', token(css, '--bg-raised')],
  ];

  it('--text-tertiary meets WCAG AA (4.5:1) for text on every dark background layer', () => {
    for (const [name, bg] of layers) {
      expect(contrast(tertiary, bg), `${tertiary} on ${name} ${bg}`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('no shared lens component still carries the old #5C584F fallback', () => {
    for (const rel of [
      'components/lens/CreatorLink.tsx',
      'components/lens/ReportButton.tsx',
      'components/lens/ShareButton.tsx',
    ]) {
      const src = readFileSync(path.join(root, rel), 'utf8');
      expect(src, rel).not.toContain('#5C584F');
      expect(src, rel).toContain('var(--text-tertiary,#948f83)');
    }
  });
});
