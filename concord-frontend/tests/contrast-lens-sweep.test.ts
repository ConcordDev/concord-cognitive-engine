/**
 * FIX (CB-0434 theme-7 contrast section): guard for the muted-text sweep.
 * On the dark theme, the 500/600 steps of the neutral Tailwind families
 * measure ~3.5–4.0:1 — below WCAG AA for the small labels, helper text
 * and metadata they were used for across the claimed lenses — and the
 * Self lens's muted rose steps (700/800) measure ~2.6–3.3:1. The sweep
 * raised every text-bearing use in the claimed lenses to the AA steps
 * (neutral 400 ≈ 6.7–7.7:1; rose 400 ≈ 6.3:1). This test keeps the
 * swept classes from coming back in those lenses, and pins the shared
 * shell's inactive tab + subtitle to the AA step as well.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const CLAIMED_LENSES = [
  'education', 'entity', 'sub-worlds', 'move-builder', 'world-creator',
  'tools', 'fishing', 'quests', 'cognitive-replay', 'ghost-tracker',
  'forecast', 'self', 'import', 'mesh', 'sync', 'understanding',
  'genesis', 'telecommunications', 'electrical', 'bridge',
];

function tsxFiles(dir: string): string[] {
  const out: string[] = [];
  let entries: string[] = [];
  try { entries = readdirSync(dir); } catch { return out; }
  for (const e of entries) {
    const p = path.join(dir, e);
    if (statSync(p).isDirectory()) out.push(...tsxFiles(p));
    else if (/\.tsx?$/.test(e)) out.push(p);
  }
  return out;
}

describe('muted-text contrast sweep (CB-0434)', () => {
  it('no claimed lens still colours text with a sub-AA neutral 500/600 step', () => {
    const bad = /text-(zinc|gray|neutral|slate|stone)-(500|600)/;
    const offenders: string[] = [];
    for (const lens of CLAIMED_LENSES) {
      for (const dir of [`components/${lens}`, `app/lenses/${lens}`]) {
        for (const f of tsxFiles(path.join(root, dir))) {
          if (bad.test(readFileSync(f, 'utf8'))) offenders.push(path.relative(root, f));
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('the Self lens no longer colours text with rose-700/800', () => {
    const bad = /text-rose-(700|800)/;
    const offenders: string[] = [];
    for (const dir of ['components/self', 'app/lenses/self']) {
      for (const f of tsxFiles(path.join(root, dir))) {
        if (bad.test(readFileSync(f, 'utf8'))) offenders.push(path.relative(root, f));
      }
    }
    expect(offenders).toEqual([]);
  });

  it('the shared shell inactive tab and subtitle sit at the AA step', () => {
    const nsf = readFileSync(path.join(root, 'components/lens/NorthStarFrame.tsx'), 'utf8');
    expect(nsf).not.toMatch(/text-zinc-(500|600)/);
  });

  it('the move-builder show-detail toggle no longer renders at opacity 0.4', () => {
    const src = readFileSync(path.join(root, 'components/move-builder/MintedMovesPanel.tsx'), 'utf8');
    expect(src).not.toContain('opacity: 0.4');
    expect(src).toContain("color: 'var(--text-tertiary)'");
  });
});
