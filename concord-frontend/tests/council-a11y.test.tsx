/**
 * FIX-council-007 — council's comboboxes and Workbench inputs were
 * unnamed (visible sibling labels with no htmlFor, placeholder-only
 * fields) and helper/card text sat at zinc-500 / gray-500-600.
 * 54 fields across the seven council files now carry aria-labels
 * taken from their visible label or field semantics; the dim text
 * instances are raised one step. Decorative icon glyphs untouched.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

const read = (p: string) => fs.readFileSync(path.join(process.cwd(), p), 'utf8');
const FILES = [
  'components/council/BrainCouncil.tsx',
  'components/council/CouncilActionPanel.tsx',
  'components/council/CouncilChamber.tsx',
  'components/council/CouncilTheaterPanel.tsx',
  'components/council/CouncilVoices.tsx',
  'components/council/DecisionArchive.tsx',
  'components/council/MeetingsWorkspace.tsx',
];

function tagEnd(s: string, i: number): number {
  let d = 0; let j = i;
  while (j < s.length) {
    const c = s[j];
    if (c === '{') d++;
    else if (c === '}') d--;
    else if (c === '>' && d === 0) return j;
    j++;
  }
  return s.length - 1;
}

describe('FIX-council-007 — council names + contrast', () => {
  it('every select/input/textarea in the council tree is named', () => {
    let total = 0;
    for (const f of FILES) {
      const s = read(f);
      const re = /<(select|input|textarea)\b/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(s)) !== null) {
        const tag = s.slice(m.index, tagEnd(s, m.index) + 1);
        total++;
        const named = tag.includes('aria-label') || tag.includes('aria-labelledby')
          || (() => { const id = /id="([^"]+)"/.exec(tag)?.[1]; return !!id && s.includes(`htmlFor="${id}"`); })();
        expect(named, `${f}: unnamed <${m[1]}> ${tag.slice(0, 60)}`).toBe(true);
      }
    }
    expect(total).toBeGreaterThan(50);
  });

  it('the workbench fields carry their visible labels as names', () => {
    const s = read('components/council/CouncilActionPanel.tsx');
    expect(s).toContain('aria-label="Members (one per line)"');
    expect(s).toContain('aria-label="Positions (name for/against/abstain)"');
    expect(s).toContain('aria-label="Conflict description (for resolve)"');
  });

  it('dim helper text is raised', () => {
    expect(read('components/council/CouncilActionPanel.tsx').includes('text-zinc-500')).toBe(false);
    const chamber = read('components/council/CouncilChamber.tsx');
    expect(chamber).toContain('text-[10px] text-gray-400');
  });
});
