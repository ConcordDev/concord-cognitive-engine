/**
 * FIX-achievements-005 (contrast leg only — the count leg was
 * B6's, found substantially cured by labelling and left to the
 * desk's re-walk) — locked achievement cards dimmed their whole
 * contents to 60% opacity with 40% grayscale, so the reward chips
 * and muted text fell below readable contrast on the dark theme.
 * Locked cards now render at 80% opacity / 25% grayscale (still
 * visibly locked, still legible), and the lens's slate-500 text
 * instances (activity timestamps, title earned lines, the search
 * placeholder) are raised to slate-400.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

const read = (p: string) => fs.readFileSync(path.join(process.cwd(), p), 'utf8');

describe('FIX-achievements-005 — achievements contrast leg', () => {
  it('locked cards stay legible', () => {
    const s = read('components/achievements/AchievementCard.tsx');
    expect(s).toContain("!earned && 'opacity-80 grayscale-[25%]'");
    expect(s.includes('opacity-60')).toBe(false);
  });

  it('slate-500 text is raised across the lens', () => {
    expect(read('components/achievements/RecentActivityFeed.tsx').includes('text-slate-500')).toBe(false);
    expect(read('components/achievements/TitlesPanel.tsx').includes('text-slate-500')).toBe(false);
    expect(read('app/lenses/achievements/page.tsx').includes('placeholder:text-slate-500')).toBe(false);
  });
});
