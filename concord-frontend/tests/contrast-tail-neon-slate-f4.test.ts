/**
 * C-CONTRAST-TAIL F4 + F2 + F5 — neon text, slate text, emerald text
 * (premise of record: ~/workspace/b7-audit/premise-v1-contrast-tail.md).
 *
 * F4: the ActionPanel genus renders `color: accent` over
 * `backgroundColor: accent + '20'` — accent text on its own tint.
 * #a855f7 on its tint measures 3.76–4.35:1, #ec4899 4.17:1. The cure is
 * the W1-18 bright step in the accent data (#c084fc / #f472b6), plus the
 * same step for same-line tint chips (text-neon-purple/-pink,
 * text-pink-500) and three premise-located neon icons whose tint comes
 * from an ancestor (market / vote / fork).
 * F2: slate-500/600 text in the slate rows' lenses -> slate-400
 * (#94a3b8, worst slate ground 6.93:1); includes Monaco's
 * editorLineNumber.foreground #475569 in the code lens.
 * F5: text-emerald-700 -> text-emerald-500 in worldmodel.
 *
 * Premise legs pass on any tree; the absence legs fail pre-fix.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { describe, it, expect } from 'vitest';
import { contrastRatio } from '@/lib/social/contrast';

const root = resolve(__dirname, '..');
const SHARED = new Set(['ui', 'shell', 'common', 'chat', 'atlas', 'history', 'social']);
const SLATE_LENSES = ['conkay', 'housing', 'auction', 'forge', 'foundry', 'code'];

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

function scopeFiles(): string[] {
  const files: string[] = [];
  walk(resolve(root, 'app/lenses'), files, false);
  walk(resolve(root, 'components'), files, true);
  return files;
}

describe('premise: the measured pairs fail AA', () => {
  it('neon / slate / emerald text pairs are under 4.5', () => {
    expect(contrastRatio('#a855f7', '#301f46')).toBeLessThan(4.5);
    expect(contrastRatio('#a855f7', '#211930')).toBeLessThan(4.5);
    expect(contrastRatio('#ec4899', '#3e1d33')).toBeLessThan(4.5);
    expect(contrastRatio('#64748b', '#0a0a0f')).toBeLessThan(4.5);
    expect(contrastRatio('#475569', '#0a0e17')).toBeLessThan(4.5);
    expect(contrastRatio('#047857', '#090d11')).toBeLessThan(4.5);
  });
});

describe('fix: the replacement pairs clear AA', () => {
  it('bright steps / slate-400 / emerald-500 are at least 4.5 on the tail grounds', () => {
    for (const g of ['#301f46', '#211930', '#29183a', '#2a193d', '#2c1b41', '#2f1f3f']) {
      expect(contrastRatio('#c084fc', g), `purple-bright on ${g}`).toBeGreaterThanOrEqual(4.5);
    }
    expect(contrastRatio('#f472b6', '#3e1d33')).toBeGreaterThanOrEqual(4.5);
    for (const g of ['#071220', '#091928', '#0d1622', '#101520', '#0a0e17']) {
      expect(contrastRatio('#94a3b8', g), `slate-400 on ${g}`).toBeGreaterThanOrEqual(4.5);
    }
    expect(contrastRatio('#10b981', '#090d11')).toBeGreaterThanOrEqual(4.5);
  });
});

describe('fix: the failing sources are absent in scope', () => {
  it('no old accent data, no same-line neon tint chips, no slate/emerald laggards', { timeout: 180_000 }, () => {
    const offenders: string[] = [];
    const tintPurple = /bg-(neon-purple|purple-(400|500|600|700|800|900))\/\d/;
    const tintPink = /bg-(neon-pink|pink-(400|500|600|700|800|900))\/\d/;
    for (const file of scopeFiles()) {
      const rel = file.slice(root.length + 1);
      const lens = rel.startsWith('app/lenses/') ? rel.split('/')[2] : rel.split('/')[1];
      const lines = readFileSync(file, 'utf8').split('\n');
      lines.forEach((line, i) => {
        if (/accent:\s*'#(a855f7|ec4899)'/.test(line) || /accent:\s*"#(a855f7|ec4899)"/.test(line)) {
          offenders.push(`${rel}:${i + 1} accent`);
        }
        if (tintPurple.test(line) && /text-neon-purple(?![\w-])/.test(line)) offenders.push(`${rel}:${i + 1} neon-purple chip`);
        if (tintPink.test(line) && /text-neon-pink(?![\w-])/.test(line)) offenders.push(`${rel}:${i + 1} neon-pink chip`);
        if (tintPink.test(line) && /text-pink-500(?![\w-])/.test(line)) offenders.push(`${rel}:${i + 1} pink-500 chip`);
        if (SLATE_LENSES.includes(lens)) {
          if (/text-slate-(500|600)(?![\w-])/.test(line)) offenders.push(`${rel}:${i + 1} slate class`);
          if (/#(64748b|475569)/i.test(line)) offenders.push(`${rel}:${i + 1} slate hex`);
        }
      });
    }
    const compare = readFileSync(resolve(root, 'components/worldmodel/ComparePanel.tsx'), 'utf8');
    expect(/text-emerald-700(?![\w-])/.test(compare)).toBe(false);
    // MarketListingsPanel left with the Auction House redesign (it has its own theme now).
    for (const f of ['app/lenses/vote/page.tsx', 'app/lenses/fork/page.tsx']) {
      expect(readFileSync(resolve(root, f), 'utf8')).toContain('text-neon-purple-bright');
    }
    expect(offenders).toEqual([]);
  });
});
