/**
 * /lenses/inheritance — four-UX-state contract.
 *
 * Pins that the Inheritance lens renders genuine loading / error (with a working
 * Retry) / empty / populated states against the real macro surface
 * (lensRun('inheritance', <macro>, …) → POST /api/lens/run answered by
 * server/domains/inheritance.js + the server.js inline list_open macro), plus
 * a11y: loading is role=status, error is role=alert with a WORKING Retry that
 * re-fetches, the empty state offers a real CTA button, the tab controls are
 * real buttons.
 *
 * The page's loadAll() Promise.all over 9 macros previously SWALLOWED a fetch
 * rejection (no try/catch) — leaving the page stuck on "Loading…". This test
 * pins that a rejected macro now surfaces a role=alert + Retry instead.
 *
 * No fabricated data: every state is driven by a mocked lensRun standing in for
 * the real backend in the exact { ok, result } shape the macros return. The
 * headless LensShell + sibling chrome + the Reddit-fetching EstateChatter are
 * stubbed inert so each assertion stays on the estate-planner state machine.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, waitFor, act } from '@testing-library/react';
import React from 'react';

// ── lensRun mock — the lens's single backend channel ────────────────────────
const lensRun = vi.fn();
vi.mock('@/lib/api/client', () => ({
  lensRun: (...args: unknown[]) => lensRun(...args),
}));

// ── headless shell + lens chrome: render-only stubs ─────────────────────────
vi.mock('@/components/lens/LensShell', () => ({
  LensShell: ({ children }: { children: React.ReactNode }) =>
    React.createElement('div', { 'data-testid': 'lens-shell' }, children),
}));
vi.mock('@/hooks/useLensCommand', () => ({ useLensCommand: () => {} }));
vi.mock('@/components/lens/RecentMineCard', () => ({ RecentMineCard: () => null }));
vi.mock('@/components/lens/AutoActionStrip', () => ({ AutoActionStrip: () => null }));
vi.mock('@/components/lens/CrossLensRecentsPanel', () => ({ CrossLensRecentsPanel: () => null }));
vi.mock('@/components/lens/FirstRunTour', () => ({ FirstRunTour: () => null }));
vi.mock('@/components/lens/DepthBadge', () => ({ DepthBadge: () => null }));
// EstateChatter hits the Reddit API via react-query — keep it inert.
vi.mock('@/components/inheritance/EstateChatter', () => ({ EstateChatter: () => null }));
// viz components — stubs so the overview chart + probate timeline mount headless.
vi.mock('@/components/viz', () => ({
  ChartKit: () => React.createElement('div', { 'data-testid': 'chart' }),
  TimelineView: () => React.createElement('div', { 'data-testid': 'timeline' }),
}));

// Import AFTER mocks are registered.
import InheritancePage from '@/app/lenses/inheritance/page';

// run() in the page returns r.data — so lensRun resolves an axios-shaped
// { data: { ok, result } } and the page consumes .data.
function reply(result: Record<string, unknown>, ok = true) {
  return Promise.resolve({ data: { ok, result } });
}

// Build a full set of macro replies keyed by macro name, with overrides.
function macroReplies(over: Record<string, unknown> = {}) {
  const base: Record<string, unknown> = {
    estate_overview: {
      beneficiaryCount: 0, assetCount: 0, willCount: 0, executorCount: 0,
      lockCount: 0, totalSharePct: 0, shareBalanced: false,
      totalAssetValueCc: 0, activeWillVersion: null, executorsConsented: 0,
    },
    list_beneficiaries: { beneficiaries: [], totalSharePct: 0, balanced: false, remainderPct: 100 },
    list_will_versions: { versions: [], activeVersion: null },
    list_assets: { assets: [], totalValueCc: 0, byCategory: {} },
    list_executors: { executors: [], consentSummary: { pending: 0, accepted: 0, declined: 0 }, fullyConsented: false },
    list_locks: { locks: [], escrowedCc: 0 },
    probate_timeline: { events: [], pendingTransfers: 0, resolvedTransfers: 0 },
    list_notices: { notices: [], unreadCount: 0 },
    // list_open is the inline MACROS macro — returns { ok, listings } un-nested.
    list_open: { listings: [] },
    ...over,
  };
  return base;
}

// Wire lensRun to answer per-macro from a replies map. list_open returns the
// un-nested inline shape; everything else returns { data: { ok, result } }.
function wire(replies: Record<string, unknown>, reject?: (macro: string) => boolean) {
  lensRun.mockImplementation((_domain: string, macro: string) => {
    if (reject?.(macro)) return Promise.reject(new Error('macro offline'));
    if (macro === 'list_open') {
      return Promise.resolve({ data: { ok: true, listings: (replies.list_open as { listings: unknown[] }).listings } });
    }
    return reply(replies[macro] as Record<string, unknown>);
  });
}

beforeEach(() => { lensRun.mockReset(); });

describe('inheritance lens — four UX states', () => {
  it('LOADING: shows a role=status indicator while the estate is in flight', async () => {
    lensRun.mockImplementation(() => new Promise(() => {})); // never resolves
    const { getByText, container } = render(<InheritancePage />);
    await waitFor(() => expect(getByText(/Loading estate/i)).toBeInTheDocument());
    expect(container.querySelector('[role="status"]')).toBeTruthy();
  });

  it('EMPTY: an empty estate shows the CTA to name a first beneficiary', async () => {
    wire(macroReplies());
    const { getByText, getByRole } = render(<InheritancePage />);
    await waitFor(() => expect(getByText(/Your estate is empty/i)).toBeInTheDocument());
    expect(getByRole('button', { name: /Name your first beneficiary/i })).toBeInTheDocument();
  });

  it('ERROR: a rejected macro shows role=alert + a working Retry that re-fetches and recovers', async () => {
    let fail = true;
    lensRun.mockImplementation((_domain: string, macro: string) => {
      if (fail) return Promise.reject(new Error('estate service offline'));
      const replies = macroReplies({
        estate_overview: {
          beneficiaryCount: 1, assetCount: 1, willCount: 0, executorCount: 0,
          lockCount: 0, totalSharePct: 100, shareBalanced: true,
          totalAssetValueCc: 500, activeWillVersion: null, executorsConsented: 0,
        },
        list_assets: { assets: [{ id: 'ast_1', label: 'Manor', category: 'property', valueCc: 500, location: '', notes: '' }], totalValueCc: 500, byCategory: {} },
      });
      if (macro === 'list_open') return Promise.resolve({ data: { ok: true, listings: [] } });
      return reply(replies[macro] as Record<string, unknown>);
    });
    const { getByText, container } = render(<InheritancePage />);
    await waitFor(() => expect(container.querySelector('[role="alert"]')).toBeTruthy());
    expect(getByText(/estate service offline/i)).toBeInTheDocument();

    const before = lensRun.mock.calls.length;
    fail = false;
    await act(async () => { fireEvent.click(getByText('Retry')); });
    await waitFor(() => expect(lensRun.mock.calls.length).toBeGreaterThan(before));
    // Recovers to populated overview — the real estate value from the macro.
    await waitFor(() => expect(getByText(/500 CC/)).toBeInTheDocument());
  });

  it('POPULATED: renders real overview rollups (estate value + share %) from the macro', async () => {
    wire(macroReplies({
      estate_overview: {
        beneficiaryCount: 2, assetCount: 3, willCount: 1, executorCount: 1,
        lockCount: 0, totalSharePct: 100, shareBalanced: true,
        totalAssetValueCc: 730, activeWillVersion: 1, executorsConsented: 1,
      },
      list_assets: { assets: [{ id: 'ast_1', label: 'Manor', category: 'property', valueCc: 730, location: '', notes: '' }], totalValueCc: 730, byCategory: { property: { count: 1, valueCc: 730 } } },
    }));
    const { getByText } = render(<InheritancePage />);
    // Real estate value surfaced in the overview stat grid.
    await waitFor(() => expect(getByText('730 CC')).toBeInTheDocument());
    expect(getByText(/shares total exactly 100%/i)).toBeInTheDocument();
  });

  it('a11y: the tab controls are real buttons with accessible text', async () => {
    wire(macroReplies());
    const { getByRole } = render(<InheritancePage />);
    await waitFor(() => expect(getByRole('button', { name: /^Overview$/i })).toBeInTheDocument());
    expect(getByRole('button', { name: /Beneficiaries/i })).toBeInTheDocument();
    expect(getByRole('button', { name: /Heir-Slot Market/i })).toBeInTheDocument();
  });

  it('POPULATED market: an open listing renders with its real heir-slot price + Lock button', async () => {
    wire(macroReplies({
      list_open: { listings: [{ id: 7, dying_npc_id: 'npc_seam', npc_name: 'Old Seam', mentor_user_id: 'user_mentor_xyz', heir_slot_price_cc: 120, listed_at: 1700000000 }] },
    }));
    const { getByText, getByRole } = render(<InheritancePage />);
    await waitFor(() => expect(getByRole('button', { name: /Heir-Slot Market/i })).toBeInTheDocument());
    await act(async () => { fireEvent.click(getByRole('button', { name: /Heir-Slot Market/i })); });
    await waitFor(() => expect(getByText('Old Seam')).toBeInTheDocument());
    expect(getByText(/120 CC/)).toBeInTheDocument();
    expect(getByRole('button', { name: /Lock heir slot/i })).toBeInTheDocument();
  });
});
