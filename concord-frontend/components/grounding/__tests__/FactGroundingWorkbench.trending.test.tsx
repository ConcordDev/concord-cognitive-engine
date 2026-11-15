/**
 * FactGroundingWorkbench trending tab — citations, not invented claims
 * (FIX-grounding-011).
 *
 * The server used to hand every most-read topic a fabricated suggested
 * claim ("Recent reporting about X is accurate") and no item carried a
 * citation. In the new shape a news item keeps its story-derived claim
 * plus its source link, and a topic item arrives with NO claim — just
 * its readership note and article link. The tab must render exactly
 * that: a Check button only where a real claim exists, the note where
 * the server sent one, and a working source link on every item.
 */
import React from 'react';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { actionOf } from '../../../tests/helpers/exercise';

const h = vi.hoisted(() => ({ lensRun: vi.fn(), post: vi.fn() }));

const TRENDING = {
  date: '2026-11-12', count: 2, source: 'Wikimedia featured-content API (most-read + in-the-news)',
  claims: [
    { kind: 'news', headline: 'A major breakthrough was announced', suggestedClaim: 'A major breakthrough was announced', checkability: 'high', sourceUrl: 'https://en.wikipedia.org/wiki/Breakthrough_coverage', sourceName: 'Wikipedia — In the news' },
    { kind: 'topic', headline: 'Stacy Keach', views: 45210, sourceUrl: 'https://en.wikipedia.org/wiki/Stacy_Keach', sourceName: 'Wikipedia — Most read', note: 'Trending by readership — this source reports views, not a claim. Open the article and pick a statement to check.' },
  ],
};

vi.mock('@/lib/api/client', () => ({
  lensRun: (...a: unknown[]) => h.lensRun(...a),
  api: { post: (...a: unknown[]) => h.post(...a) },
}));
vi.mock('@/components/dtu/ContentClassLicenseFields', () => ({ withContentLicense: (x: unknown) => x }));
vi.mock('@/components/viz', () => ({
  ChartKit: () => <div>chart</div>,
  TimelineView: () => <div>timeline</div>,
}));
vi.mock('framer-motion', () => ({
  motion: new Proxy({}, { get: () => ({ children }: { children?: React.ReactNode }) => <div>{children}</div> }),
  AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

import { FactGroundingWorkbench } from '../FactGroundingWorkbench';

const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 30)); });
const click = async (el: Element) => { await act(async () => { fireEvent.click(el); await new Promise((r) => setTimeout(r, 25)); }); };

beforeEach(() => {
  h.lensRun.mockReset(); h.post.mockReset();
  h.lensRun.mockImplementation(async (...a: unknown[]) => {
    const action = actionOf(a);
    if (action === 'trendingClaims') return { data: { ok: true, result: TRENDING } };
    // The workbench loads its audit trail on mount; give it the full shape.
    if (action === 'auditTrail') {
      return { data: { ok: true, result: { totalChecks: 0, checks: [], trail: [], stats: { verdictDistribution: {}, avgProbabilityTrue: null } } } };
    }
    return { data: { ok: true, result: { ok: true } } };
  });
  h.post.mockImplementation(async () => ({ data: { ok: true } }));
});
afterEach(() => cleanup());

describe('FactGroundingWorkbench trending tab (FIX-grounding-011)', () => {
  it('renders citations on every item and a claim only where the source made one', async () => {
    const v = render(<FactGroundingWorkbench />);
    await settle();
    const tab = screen.getAllByRole('button').find((x) => (x.textContent || '').trim() === 'Trending claims');
    await click(tab as Element);
    const pull = screen.getAllByRole('button').find((x) => (x.textContent || '').includes('Pull trending claims'));
    await click(pull as Element);
    await settle();

    const text = v.container.textContent || '';
    // The news item: its real claim, its Check button, its citation.
    expect(text).toContain('Suggested claim: A major breakthrough was announced');
    expect(text).toContain('Wikipedia — In the news');
    // The topic item: NO suggested claim, NO check button of its own —
    // the readership note and its citation instead.
    expect(text).not.toContain('Stacy Keach is accurate');
    expect(text).toContain('Trending by readership — this source reports views, not a claim.');
    expect(text).toContain('Wikipedia — Most read');
    const checkButtons = screen.getAllByRole('button').filter((x) => (x.textContent || '').includes('Check this claim'));
    expect(checkButtons.length).toBe(1);
    const hrefs = Array.from(v.container.querySelectorAll('a')).map((a) => a.getAttribute('href'));
    expect(hrefs).toContain('https://en.wikipedia.org/wiki/Breakthrough_coverage');
    expect(hrefs).toContain('https://en.wikipedia.org/wiki/Stacy_Keach');
  });
});
