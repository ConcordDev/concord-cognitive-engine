/**
 * C-CONTRAST-TAIL F1 — the muted-gray family of the §C contrast tail
 * (root-cause claims 2026-11-19; premise of record:
 * ~/workspace/b7-audit/premise-v1-contrast-tail.md at the B7 seat).
 *
 * The walker's tail rows pair muted text — zinc-500 #71717a, gray-500
 * #6b7280, gray-600 #4b5563, zinc-600 #52525b — with dark lens grounds at
 * 2.56–4.44:1, under WCAG AA 4.5. MST-W1-18 cured the pairs only inside
 * its ~22 migrated shared components; it changed no palette value and
 * touched no lens file, so the same classes in lens code kept failing.
 *
 * F1 migrates the muted-text classes in the 47 tail-named lenses to the
 * platform's semantic muted token (text-lattice-muted, the W1-18 token:
 * #a1a1aa on dark grounds — worst tail ground #343438 measures 4.84:1)
 * and the four muted hex literals (chart colours) to #a1a1aa.
 *
 * Composition note: text-lattice-muted resolves through the W1-18 legs
 * (globals.css --lattice-muted + tailwind lattice.muted), which land in
 * the same Gate 2 batch as this stack.
 *
 * Premise legs pass on any tree; the absence legs fail on the pre-fix
 * tree, where the failing classes are present throughout the lenses.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { describe, it, expect } from 'vitest';
import { contrastRatio } from '@/lib/social/contrast';

const root = resolve(__dirname, '..');

const LENSES = [
  'anon', 'repos', 'legacy', 'mail', 'creator', 'bounties', 'classroom',
  'crisis-ops', 'code', 'timeline', 'podcast', 'billing', 'crypto', 'hr',
  'lab', 'law', 'garage', 'civic-bonds', 'careers', 'goddess',
  'photography', 'crafting', 'narrative-walk', 'photos', 'maker',
  'database', 'robotics', 'tick', 'affect', 'creative-writing',
  'questmarket', 'saved', 'landscaping', 'lock', 'invariant', 'reasoning',
  'reasoning-traces', 'projects', 'society', 'marketplace', 'space',
  'calendar', 'fractal', 'wellness', 'frontier', 'queue', 'energy',
  'event-timeline', 'death-insurance',
];

const FAILING_CLASSES = ['text-zinc-500', 'text-gray-500', 'text-gray-600', 'text-zinc-600'];
const FAILING_HEXES = ['#71717a', '#6b7280', '#4b5563', '#52525b'];
// Every ground the muted family pairs with in the tail.
const TAIL_GROUNDS = [
  '#111111', '#1d1d22', '#343438', '#09090b', '#12121a', '#0d0d14',
  '#0e0e13', '#181818', '#0a0a0f', '#18181b', '#000000', '#121215',
  '#09090d', '#090c10', '#0c0c0c', '#0c0c12', '#0e0e10', '#111e25',
  '#16161e', '#1a1a24', '#07070a', '#080808', '#0f0f12', '#101014',
  '#141415', '#151519', '#16110f', '#161616',
];

function walk(dir: string, out: string[]): void {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const name of entries) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path, out);
    else if (/\.(ts|tsx)$/.test(name) && !/\.test\.(ts|tsx)$/.test(name)) out.push(path);
  }
}

describe('premise: the measured muted pairs fail AA', () => {
  it('zinc-500 on the tail grounds is under 4.5', () => {
    expect(contrastRatio('#71717a', '#111111')).toBeLessThan(4.5);
    expect(contrastRatio('#71717a', '#343438')).toBeLessThan(4.5);
    expect(contrastRatio('#6b7280', '#111111')).toBeLessThan(4.5);
    expect(contrastRatio('#4b5563', '#12121a')).toBeLessThan(4.5);
    expect(contrastRatio('#52525b', '#09090b')).toBeLessThan(4.5);
  });
});

describe('fix: the replacement clears AA on every tail ground', () => {
  it('#a1a1aa (lattice-muted, dark) clears 4.5 on all muted-family grounds', () => {
    for (const ground of TAIL_GROUNDS) {
      expect(contrastRatio('#a1a1aa', ground), `ground ${ground}`).toBeGreaterThanOrEqual(4.5);
    }
  });
});

describe('fix: no failing muted class or hex remains in the named lenses', () => {
  for (const lens of LENSES) {
    it(`${lens}: migrated`, () => {
      const files: string[] = [];
      walk(resolve(root, 'app/lenses', lens), files);
      walk(resolve(root, 'components', lens), files);
      const offenders: string[] = [];
      for (const file of files) {
        const src = readFileSync(file, 'utf8');
        for (const cls of FAILING_CLASSES) {
          const re = new RegExp(`${cls}(?![\\w-])`);
          if (re.test(src)) offenders.push(`${file}: ${cls}`);
        }
        for (const hex of FAILING_HEXES) {
          if (new RegExp(hex, 'i').test(src)) offenders.push(`${file}: ${hex}`);
        }
      }
      expect(offenders).toEqual([]);
    });
  }
});
