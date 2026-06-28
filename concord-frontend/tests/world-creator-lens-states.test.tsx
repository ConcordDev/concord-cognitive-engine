/**
 * /lenses/world-creator — four-UX-state contract (DraftGallery surface).
 *
 * Pins that the World Creator landing surface renders genuine loading /
 * error (with a working Retry that re-fetches) / empty / populated states
 * against the real macro surface (lensRun('world-creator', 'draft-list', …)
 * → POST /api/lens/run that server/domains/world-creator.js answers), plus
 * a11y (loading is role=status, error is role=alert with a working Retry).
 *
 * No fabricated data: every state is driven by a mocked lensRun standing in
 * for the real backend, in exactly the { drafts } / { templates } / { worlds }
 * shapes the macros return. The headless LensShell + the sr-only sentinel
 * cards + the DraftEditor child are stubbed so the test stays on the page's
 * own gallery state machine.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, waitFor, act } from '@testing-library/react';
import React from 'react';

// ── lensRun mock — the gallery's single backend channel ─────────────────────
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
vi.mock('@/components/world-creator/WorldBuilderInspo', () => ({ WorldBuilderInspo: () => null }));
// DraftEditor only mounts after a draft is opened; inert here.
vi.mock('@/components/world-creator/DraftEditor', () => ({
  DraftEditor: ({ draftId }: { draftId: string }) =>
    React.createElement('div', { 'data-testid': 'draft-editor' }, `editing ${draftId}`),
}));
vi.mock('next/link', () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) =>
    React.createElement('a', { href }, children),
}));

// Import AFTER mocks are registered.
import WorldCreatorPage from '@/app/lenses/world-creator/page';

// lensRun returns an axios-shaped { data: { ok, result } }.
function reply(result: Record<string, unknown>, ok = true) {
  return Promise.resolve({ data: { ok, result } });
}

const DRAFT = {
  id: 'draft_1', name: 'Frostgate', biomeLabel: 'Frozen Tundra', universeType: 'concordia-hub',
  template: null, visibility: 'private', publishedWorldId: null,
  propCount: 4, npcCount: 2, zoneCount: 1, spawnCount: 1, factionCount: 0, updatedAt: '2026-01-01',
};

// Route a lensRun call to its per-macro responder.
function routed(handlers: Record<string, () => Promise<unknown>>) {
  return (domain: string, action: string) => {
    const h = handlers[action];
    if (h) return h();
    // sensible defaults for the auxiliary macros the gallery fires
    if (action === 'templates') return reply({ templates: [] });
    if (action === 'discover') return reply({ worlds: [] });
    return reply({});
  };
}

beforeEach(() => { lensRun.mockReset(); });

describe('world-creator lens — four UX states', () => {
  it('LOADING: shows a role=status indicator while the drafts list is in flight', async () => {
    lensRun.mockImplementation(routed({
      'draft-list': () => new Promise(() => {}), // never resolves
    }));
    const { container, getByText } = render(<WorldCreatorPage />);
    await waitFor(() => expect(container.querySelector('[role="status"]')).toBeTruthy());
    expect(getByText(/Loading your draft worlds/i)).toBeInTheDocument();
  });

  it('EMPTY: shows the honest "No drafts yet" CTA when the list is empty', async () => {
    lensRun.mockImplementation(routed({
      'draft-list': () => reply({ drafts: [] }),
    }));
    const { getByText } = render(<WorldCreatorPage />);
    await waitFor(() => expect(getByText(/No drafts yet/i)).toBeInTheDocument());
    expect(getByText(/Start a blank draft or pick a template/i)).toBeInTheDocument();
  });

  it('ERROR: a failed list load shows role=alert + a working Retry that re-fetches', async () => {
    let fail = true;
    lensRun.mockImplementation(routed({
      'draft-list': () =>
        fail
          ? Promise.resolve({ data: { ok: false, error: 'STATE unavailable' } })
          : reply({ drafts: [DRAFT] }),
    }));
    const { container, getByText } = render(<WorldCreatorPage />);
    await waitFor(() => expect(container.querySelector('[role="alert"]')).toBeTruthy());
    expect(getByText(/STATE unavailable/i)).toBeInTheDocument();

    const before = lensRun.mock.calls.filter((c) => c[1] === 'draft-list').length;
    fail = false;
    await act(async () => { fireEvent.click(getByText('Try again')); });
    await waitFor(() =>
      expect(lensRun.mock.calls.filter((c) => c[1] === 'draft-list').length).toBeGreaterThan(before));
    // recovers to populated
    await waitFor(() => expect(getByText('Frostgate')).toBeInTheDocument());
  });

  it('POPULATED: renders the real draft row with its macro-computed counts', async () => {
    lensRun.mockImplementation(routed({
      'draft-list': () => reply({ drafts: [DRAFT] }),
    }));
    const { getByText } = render(<WorldCreatorPage />);
    await waitFor(() => expect(getByText('Frostgate')).toBeInTheDocument());
    // the summary line carries the real counts from the macro result
    expect(getByText(/4 props/)).toBeInTheDocument();
    expect(getByText(/2 NPCs/)).toBeInTheDocument();
  });

  it('a11y: the "Start a new world" controls are real buttons with accessible text', async () => {
    lensRun.mockImplementation(routed({ 'draft-list': () => reply({ drafts: [] }) }));
    const { getByRole } = render(<WorldCreatorPage />);
    await waitFor(() => expect(getByRole('button', { name: /Blank draft/i })).toBeInTheDocument());
  });

  it('error surface is role=alert (not a silently-empty page) on backend failure', async () => {
    lensRun.mockImplementation(routed({
      'draft-list': () => Promise.resolve({ data: { ok: false, error: 'backend exploded' } }),
    }));
    const { container, getByText } = render(<WorldCreatorPage />);
    await waitFor(() => expect(container.querySelector('[role="alert"]')).toBeTruthy());
    expect(getByText(/backend exploded/i)).toBeInTheDocument();
  });
});
