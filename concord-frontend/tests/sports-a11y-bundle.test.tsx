/**
 * FIX-sports-005 — the Sports lens's Lighthouse bundle (a11y legs):
 * contrast, touch targets, heading order. (The bundle's perf leg —
 * live score payload weight — is a data matter, recorded as a rider
 * for the desk, not a markup fix.)
 *
 * All 7 selects named (sport/level, sport kind, home/away team,
 * spectator sport, training intensity) and floored. Headings are
 * priced per composed view — one panel per page view: the view
 * panels' titles are h2 (Matches "Log a match" with its group titles
 * at h3, Stats' Record/Form, Training, Leagues, Activity); the Club
 * view's FanSection h2 stands with its tab panels' h3s beneath it;
 * SpectatorHub's h2 stands and its standings group labels are h3
 * beneath it. Dim text raised; the p-1/p-0.5 icon toggles floored.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';
import * as fs from 'node:fs';
import * as path from 'node:path';

vi.mock('@/lib/api/client', () => ({
  lensRun: vi.fn(async () => ({ data: { ok: true, result: { teams: [] } } })),
  api: { get: vi.fn(async () => ({ data: null })), post: vi.fn(async () => ({ data: null })) },
}));

import { MatchSimulator } from '@/components/sports/MatchSimulator';

const read = (p: string) => fs.readFileSync(path.join(process.cwd(), p), 'utf8');

function openingTag(src: string, start: number): string {
  let depth = 0;
  for (let k = start; k < src.length; k++) {
    const c = src[k];
    if (c === '{') depth++;
    else if (c === '}') depth--;
    else if (c === '>' && depth === 0) return src.slice(start, k + 1);
  }
  return src.slice(start);
}

describe('FIX-sports-005 — sports a11y bundle', () => {
  it('MatchSimulator: home and away team selects are named and floored', async () => {
    render(<MatchSimulator leagueId="lg-1" reloadToken={0} onPlayed={vi.fn()} />);
    for (const lab of ['Home team', 'Away team']) {
      const sel = await screen.findByLabelText(lab);
      expect(sel.className).toContain('min-h-11');
    }
  });

  it('source sweep: every sports select is named and floored', () => {
    const files = [
      ...fs.readdirSync(path.join(process.cwd(), 'components', 'sports')).filter((x) => x.endsWith('.tsx') && !x.includes('.test.')).map((x) => `components/sports/${x}`),
      'app/lenses/sports/page.tsx',
    ];
    let count = 0;
    for (const f of files) {
      const src = read(f);
      let i = 0;
      for (;;) {
        const j = src.indexOf('<select', i);
        if (j < 0) break;
        count++;
        const tag = openingTag(src, j);
        const pre = src.slice(0, j);
        const wrapped = pre.lastIndexOf('<label') > pre.lastIndexOf('</label>');
        expect(tag.includes('aria-label') || wrapped, `${f}: select without a name`).toBe(true);
        expect(tag.includes('min-h-11'), `${f}: select without the target floor`).toBe(true);
        i = j + tag.length;
      }
    }
    expect(count).toBe(7);
  });

  it('view-panel titles promoted; standings group labels at h3 under the hub h2', () => {
    expect(read('components/sports/SportsStatsPanel.tsx')).toContain('<h2');
    expect(read('components/sports/SportsTrainingPanel.tsx')).toContain('<h2');
    expect(read('components/sports/SportsLeaguesPanel.tsx')).toContain('<h2');
    const hub = read('components/sports/SportsSpectatorHub.tsx');
    expect(hub).toContain('<h2 className="text-sm font-bold text-zinc-100">Spectator Center</h2>');
    expect(hub).toContain('<h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-zinc-400">');
    expect(hub.includes('<h4')).toBe(false);
  });
});
