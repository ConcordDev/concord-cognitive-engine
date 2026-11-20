/**
 * C-CONTRAST-TAIL F3 — the saturated-fill family of the §C contrast tail
 * (premise of record: ~/workspace/b7-audit/premise-v1-contrast-tail.md).
 *
 * The tail rows pair white / 50-step text with saturated fills in lens
 * code — emerald-600, blue-500, rose-500, cyan-600, teal-600, green-600,
 * amber-600, and the emerald/amber 500/80 composites — at 2.9–4.4:1,
 * under WCAG AA 4.5. MST-W1-18's fill cure (the pink split) reached two
 * shared components; lens code kept the failing pairs.
 *
 * F3 shifts the fill one step darker on every lens-code line that pairs
 * a bare family fill class with a light text class (the measured defect
 * pattern), companions (hover steps, gradient stops) shifting in step.
 * Non-text uses of the same classes (dots, bars, charts) are untouched,
 * as are lines whose only family token is variant-prefixed (their base
 * already sits a step darker). Shared-chrome dirs (ui, shell, common,
 * chat, atlas, history, social) are out of scope — the W1-18 family's
 * ground, named in the premise.
 *
 * Premise legs pass on any tree; the absence legs fail on the pre-fix
 * tree (582 qualifying lines at f4f1f77ff).
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { describe, it, expect } from 'vitest';
import { contrastRatio } from '@/lib/social/contrast';

const root = resolve(__dirname, '..');
const SHARED = new Set(['ui', 'shell', 'common', 'chat', 'atlas', 'history', 'social']);
const LIGHT_TEXT =
  /text-(white|zinc-50|neutral-50|stone-50|gray-50|slate-50|emerald-50|amber-50|teal-50|cyan-50|blue-50|rose-50|green-50|lime-50|yellow-50|orange-50|red-50|purple-50|pink-50|indigo-50|sky-50|fuchsia-50|violet-50)(?![\w-])/;
const FAMILY_BASES = [
  /(?<![:\w-])bg-emerald-600(?![\w-])/,
  /(?<![:\w-])bg-blue-500(?![\w-])/,
  /(?<![:\w-])bg-rose-500(?![\w-])/,
  /(?<![:\w-])bg-cyan-600(?![\w-])/,
  /(?<![:\w-])bg-teal-600(?![\w-])/,
  /(?<![:\w-])bg-green-600(?![\w-])/,
  /(?<![:\w-])bg-amber-600(?![\w-])/,
  /(?<![:\w-])bg-emerald-500\/80(?![\w/])/,
  /(?<![:\w-])bg-amber-500\/80(?![\w/])/,
];

function walk(dir: string, out: string[], skipShared: boolean): void {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const name of entries) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      if (skipShared && SHARED.has(name)) continue;
      walk(path, out, false);
    } else if (/\.(ts|tsx)$/.test(name) && !/\.test\.(ts|tsx)$/.test(name)) out.push(path);
  }
}

describe('premise: the measured fill pairs fail AA', () => {
  it('white / 50-step text on the family fills is under 4.5', () => {
    expect(contrastRatio('#ffffff', '#059669')).toBeLessThan(4.5);
    expect(contrastRatio('#ffffff', '#3b82f6')).toBeLessThan(4.5);
    expect(contrastRatio('#ffffff', '#f43f5e')).toBeLessThan(4.5);
    expect(contrastRatio('#ffffff', '#0891b2')).toBeLessThan(4.5);
    expect(contrastRatio('#ffffff', '#0d9488')).toBeLessThan(4.5);
    expect(contrastRatio('#ffffff', '#16a34a')).toBeLessThan(4.5);
    expect(contrastRatio('#fffbeb', '#d97706')).toBeLessThan(4.5);
  });
});

describe('fix: the one-step-darker fills clear AA', () => {
  it('every replacement pair is at least 4.5', () => {
    expect(contrastRatio('#ffffff', '#047857')).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio('#ffffff', '#2563eb')).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio('#ffffff', '#e11d48')).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio('#ffffff', '#0e7490')).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio('#ffffff', '#0f766e')).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio('#ffffff', '#15803d')).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio('#fffbeb', '#b45309')).toBeGreaterThanOrEqual(4.5);
    // Composites are asserted against the solid 700 fills: over the
    // lenses' dark grounds an /80 composite is darker than the solid,
    // so the solid value is the conservative bound.
    expect(contrastRatio('#ecfdf5', '#047857')).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio('#fffbeb', '#b45309')).toBeGreaterThanOrEqual(4.5);
  });
});

describe('fix: no lens-code line pairs a family fill with light text', () => {
  it('the co-location pattern is absent in scope', { timeout: 180_000 }, () => {
    const files: string[] = [];
    walk(resolve(root, 'app/lenses'), files, false);
    walk(resolve(root, 'components'), files, true);
    const offenders: string[] = [];
    for (const file of files) {
      const lines = readFileSync(file, 'utf8').split('\n');
      lines.forEach((line, i) => {
        if (LIGHT_TEXT.test(line) && FAMILY_BASES.some((re) => re.test(line))) {
          offenders.push(`${file}:${i + 1}`);
        }
      });
    }
    expect(offenders).toEqual([]);
  });
});
