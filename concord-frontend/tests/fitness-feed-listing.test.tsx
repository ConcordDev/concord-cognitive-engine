/**
 * Fitness F14 — the wger feed LISTING must actually surface, in the
 * states a member can reach.
 *
 * History: #2190 built the listing into the pull response, but (a) the
 * panel was mounted inside <CommunityRedditSlot> and the Feed tab was
 * omitted from the tab bar (fixed by #2207, mount pins below), and
 * (b) R3's re-check of #2207 then failed the listing itself: the seen
 * set is corpus-level, so every reachable pull is the seen form —
 * which carried fallback labels ("Exercise 184") and no DTU ids — and
 * the listing died on reload. The completion fix makes the listing
 * the STORED library (fitness.feed-library): names resolved from
 * wger exerciseinfo, DTU ids recorded at ingest, rendered on mount.
 *
 * Pins:
 *   1. Mount load — the stored listing renders on mount with NO pull:
 *      names + full DTU ids, seen items included (reload persistence).
 *   2. Seen-form pull — a 0-new / all-seen pull still lists names +
 *      full DTU ids (the reachable state), not bare "already ingested".
 *   3. Fresh pull — new ingests list by name with full ids, marked NEW.
 *   4. Mount (structural, from #2207) — WgerFeedPanel is NOT inside
 *      CommunityRedditSlot, and the Feed view is NOT omitted from the
 *      tab bar.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, waitFor, fireEvent } from '@testing-library/react';
import React from 'react';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const lensRunMock = vi.fn();
vi.mock('@/lib/api/client', () => ({
  lensRun: (...args: unknown[]) => lensRunMock(...args),
  apiHelpers: { lens: { runDomain: vi.fn() } },
  api: { post: vi.fn(() => Promise.resolve({ data: { ok: true } })) },
}));

import { WgerFeedPanel } from '@/components/fitness/WgerFeedPanel';

const LIBRARY = [
  { name: 'Deadlifts', dtuId: 'dtu_wger_full_id_184', exerciseId: 184 },
  { name: 'Squats', dtuId: 'dtu_wger_full_id_185', exerciseId: 185 },
];

function mockActions(feedResult: unknown, libraryItems: unknown[] = []) {
  lensRunMock.mockImplementation((arg: { action?: string }) => {
    if (arg?.action === 'feed-library') return Promise.resolve({ data: { ok: true, result: { source: 'wger-exercises', items: libraryItems }, error: null } });
    if (arg?.action === 'feed') return Promise.resolve({ data: { ok: true, result: feedResult, error: null } });
    return Promise.resolve({ data: { ok: true, result: {}, error: null } });
  });
}

beforeEach(() => { lensRunMock.mockReset(); });
afterEach(() => { vi.clearAllMocks(); vi.restoreAllMocks(); });

describe('F14 completion — the stored listing', () => {
  it('renders the stored library on mount with no pull (names + full DTU ids, seen items included)', async () => {
    mockActions(null, LIBRARY);
    const view = render(<WgerFeedPanel />);
    await waitFor(() => expect(view.getByText('Deadlifts')).toBeTruthy());
    expect(view.getByText('Squats')).toBeTruthy();
    expect(view.getByText('dtu_wger_full_id_184')).toBeTruthy();
    expect(view.getByText('dtu_wger_full_id_185')).toBeTruthy();
    // No pull was needed — and none was made.
    expect(lensRunMock.mock.calls.some((c) => (c[0] as { action?: string })?.action === 'feed')).toBe(false);
  });

  it('a seen-form pull (0 new) still lists names + full DTU ids', async () => {
    mockActions({ ingested: 0, skipped: 2, source: 'wger-exercises', dtuIds: [], library: LIBRARY }, []);
    const view = render(<WgerFeedPanel />);
    fireEvent.click(view.getByRole('button', { name: /pull feed/i }));
    await waitFor(() => expect(view.getByText('Deadlifts')).toBeTruthy());
    expect(view.getByText(/0 new DTUs from wger-exercises/)).toBeTruthy();
    expect(view.getByText(/2 already seen/)).toBeTruthy();
    expect(view.getByText('dtu_wger_full_id_184')).toBeTruthy();
    expect(view.getByText('Squats')).toBeTruthy();
  });

  it('a fresh pull lists new ingests by name with full ids, marked NEW', async () => {
    mockActions({ ingested: 2, skipped: 0, source: 'wger-exercises', dtuIds: ['dtu_wger_full_id_184', 'dtu_wger_full_id_185'], library: LIBRARY }, []);
    const view = render(<WgerFeedPanel />);
    fireEvent.click(view.getByRole('button', { name: /pull feed/i }));
    await waitFor(() => expect(view.getByText('Deadlifts')).toBeTruthy());
    expect(view.getByText(/2 new DTUs from wger-exercises/)).toBeTruthy();
    expect(view.getAllByText('NEW').length).toBe(2);
  });
});

describe('F14 fix (#2207) — the mount: the listing is not behind the Reddit gate', () => {
  const src = readFileSync(path.join(process.cwd(), 'components/fitness/FitnessApp.tsx'), 'utf8');

  it('does not omit the Feed view from the tab bar', () => {
    expect(src).not.toMatch(/omitCommunityRedditViews\(MODE_TABS, \[.Feed.\]\)/);
    expect(src).not.toContain('omitCommunityRedditViews');
  });

  it('mounts WgerFeedPanel outside CommunityRedditSlot in the Feed tab', () => {
    const feedBlock = src.slice(src.indexOf("{activeTab === 'Feed'"));
    const block = feedBlock.slice(0, feedBlock.indexOf(')}', feedBlock.indexOf('<WgerFeedPanel')) + 2);
    const slotOpen = block.indexOf('<CommunityRedditSlot>');
    const slotClose = block.indexOf('</CommunityRedditSlot>');
    const panelAt = block.indexOf('<WgerFeedPanel />');
    expect(slotOpen).toBeGreaterThan(-1);
    expect(slotClose).toBeGreaterThan(slotOpen);
    // The Reddit panel stays inside the slot; the wger panel sits after it.
    expect(block.slice(slotOpen, slotClose)).toContain('<FitnessFeed />');
    expect(block.slice(slotOpen, slotClose)).not.toContain('WgerFeedPanel');
    expect(panelAt).toBeGreaterThan(slotClose);
  });
});
