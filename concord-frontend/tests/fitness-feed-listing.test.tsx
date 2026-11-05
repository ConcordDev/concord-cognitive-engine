/**
 * Fitness F14 fix — the wger feed LISTING must actually surface.
 *
 * R3's re-pass of #2190 (2026-11-04): the ingest worked ("Ingested 12
 * new DTUs from wger-exercises") but no panel listed the items — the
 * WgerFeedPanel "does not appear". Diagnosis: the panel was mounted
 * inside <CommunityRedditSlot> (renders null while the Reddit
 * community flag is off) AND the Feed tab itself was dropped from the
 * tab bar by omitCommunityRedditViews(MODE_TABS, ['Feed']). The wger
 * feed is lens-native content, not Reddit content; both gates are
 * removed for it here — the Reddit panel (FitnessFeed) keeps its own
 * gating untouched.
 *
 * Pins:
 *   1. Behaviour — the panel's Pull feed lists the batch by name with
 *      full DTU ids for fresh ingests (the re-check's exact leg).
 *   2. Mount — in FitnessApp, WgerFeedPanel is NOT inside
 *      CommunityRedditSlot, and the Feed view is NOT omitted from the
 *      tab bar. (The defect was structural — a mount/nav placement —
 *      so the mount itself is pinned structurally, in the fleet's
 *      ratchet style.)
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

beforeEach(() => { lensRunMock.mockReset(); });
afterEach(() => { vi.clearAllMocks(); vi.restoreAllMocks(); });

describe('F14 fix — WgerFeedPanel lists the pulled batch', () => {
  it('renders each exercise by name with its full DTU id after Pull feed', async () => {
    lensRunMock.mockImplementation((arg: { action?: string }) =>
      arg?.action === 'feed'
        ? Promise.resolve({
            data: {
              ok: true,
              result: {
                ingested: 2, skipped: 1, source: 'wger-exercises',
                exercises: [
                  { name: 'Squat', dtuId: 'dtu_wger_full_id_123', fresh: true },
                  { name: 'Plank', dtuId: 'dtu_wger_full_id_456', fresh: true },
                  { name: 'Crunch', dtuId: null, fresh: false },
                ],
              },
              error: null,
            },
          })
        : Promise.resolve({ data: { ok: true, result: {}, error: null } }));
    const view = render(<WgerFeedPanel />);
    fireEvent.click(view.getByRole('button', { name: /pull feed/i }));
    await waitFor(() => expect(view.getByText('Squat')).toBeTruthy());
    expect(view.getByText('Plank')).toBeTruthy();
    expect(view.getByText('dtu_wger_full_id_123')).toBeTruthy();
    expect(view.getByText('dtu_wger_full_id_456')).toBeTruthy();
    expect(view.getByText('Crunch')).toBeTruthy();
    expect(view.getByText(/already ingested/)).toBeTruthy();
    expect(view.getByText(/2 new DTUs from wger-exercises/)).toBeTruthy();
  });
});

describe('F14 fix — the mount: the listing is not behind the Reddit gate', () => {
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
