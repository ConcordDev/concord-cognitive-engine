/**
 * FIX-affect-008 (markup legs) — Lighthouse flagged unlabeled range
 * sliders and selects plus dim text on /lenses/affect. Every control
 * in the three panels now carries the accessible name its visible
 * label already showed, and the dimmest text steps up a grade. The
 * CLS leg (live-polling reflow) is a live-measurement item and stays
 * the desk's post-deploy check.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

const read = (p: string) => fs.readFileSync(path.join(process.cwd(), p), 'utf8');

function unlabeled(src: string): string[] {
  const out: string[] = [];
  const re = /<(select|input)\b(?:[^>{]|\{[^}]*\})*>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    const t = m[0];
    if (!t.includes('aria-label') && !t.includes('aria-labelledby') && !t.includes('id=')) out.push(t.slice(0, 60));
  }
  return out;
}

describe('FIX-affect-008 — affect controls are named', () => {
  it('DimensionsPanel sliders and select carry names', () => {
    const s = read('components/affect/DimensionsPanel.tsx');
    expect(s).toContain('aria-label="Intensity"');
    expect(s).toContain('aria-label="Polarity"');
    expect(unlabeled(s)).toEqual([]);
  });

  it('EventLogPanel filter selects carry names', () => {
    const s = read('components/affect/EventLogPanel.tsx');
    expect(s).toContain('aria-label="Event Type"');
    expect(s).toContain('aria-label="Dimension"');
    expect(unlabeled(s)).toEqual([]);
  });

  it('MoodTracker reminder controls carry names', () => {
    const s = read('components/affect/MoodTracker.tsx');
    expect(s).toContain('aria-label="Reminder label (optional)"');
    expect(unlabeled(s)).toEqual([]);
  });

  it('the page subtitle is not zinc-500 body text', () => {
    const s = read('app/lenses/affect/page.tsx');
    expect(s).not.toContain('max-w-2xl text-[14px] text-zinc-500');
  });
});
