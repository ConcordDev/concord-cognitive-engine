/// <reference types="@testing-library/jest-dom/vitest" />
// concord-frontend/components/conkay/panels/MacroLibraryPanel.test.tsx
//
// F4 — pins the Macro Library panel (K3) against the REAL response shape
// of GET /api/lens-actions/:domain (server.js): { ok, domain, total,
// actions: [{ action, desc, brain, isAi, isGenerative, isAnalysis, isLive,
// isCompute }] }. Verifies: grouping by isLive/isAi/isCompute, the
// "not yet live" honest label + visual distinction for non-isLive entries,
// an honest error state on fetch failure, and that nothing beyond the
// fetched actions ever renders.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { useConkayHudStore } from '../conkayHudStore';
import { MacroLibraryPanel } from './MacroLibraryPanel';

beforeEach(() => {
  useConkayHudStore.getState().reset();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function mockFetchOk(body: Record<string, unknown>) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => body,
    })),
  );
}

describe('MacroLibraryPanel', () => {
  it('fetches /api/lens-actions/:domain for the active domain and renders returned actions grouped by isLive/isAi/isCompute', async () => {
    useConkayHudStore.getState().macroStarted({ runId: 'r1', domain: 'math', action: 'naturalQuery' });
    useConkayHudStore.getState().macroCompleted({ runId: 'r1', domain: 'math', action: 'naturalQuery', ok: true, ms: 5 });

    const fetchMock = vi.fn(async (url: string) => ({
      ok: true,
      status: 200,
      json: async () => ({
        ok: true,
        domain: 'math',
        total: 3,
        actions: [
          { action: 'live_marketData', desc: 'live feed', brain: null, isAi: false, isGenerative: false, isAnalysis: false, isLive: true, isCompute: false },
          { action: 'naturalQuery', desc: 'CAS query', brain: 'utility', isAi: true, isGenerative: false, isAnalysis: false, isLive: false, isCompute: false },
          { action: 'symbolicDiff', desc: null, brain: null, isAi: false, isGenerative: false, isAnalysis: false, isLive: false, isCompute: true },
        ],
      }),
    }));
    vi.stubGlobal('fetch', fetchMock);

    render(<MacroLibraryPanel />);

    await waitFor(() => expect(screen.getByText(/Live market Data/)).toBeInTheDocument());
    expect(fetchMock).toHaveBeenCalledWith('/api/lens-actions/math');

    // Grouped headings present.
    expect(screen.getByText('Live')).toBeInTheDocument();
    expect(screen.getByText('AI-backed')).toBeInTheDocument();
    expect(screen.getByText('Compute')).toBeInTheDocument();

    // Live entry gets the "live" badge, not "not yet live".
    expect(screen.getByText('live')).toBeInTheDocument();

    // Non-live entries (AI + compute) both render the honest "not yet live" badge.
    expect(screen.getAllByText('not yet live')).toHaveLength(2);
  });

  it('renders an action with isLive:false labeled "not yet live" and visually distinguished from a live entry', async () => {
    mockFetchOk({
      ok: true,
      domain: 'reason',
      total: 1,
      actions: [
        { action: 'verify', desc: 'reason.verify', brain: 'conscious', isAi: true, isGenerative: false, isAnalysis: false, isLive: false, isCompute: false },
      ],
    });

    render(<MacroLibraryPanel />);

    const badge = await screen.findByText('not yet live');
    expect(badge).toBeInTheDocument();
    // Distinct styling from the emerald "live" badge — zinc/gray treatment.
    expect(badge.className).toMatch(/zinc/);
    expect(badge.className).not.toMatch(/emerald/);
  });

  it('renders an honest error state (not a blank/empty panel) when the fetch fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('network down');
      }),
    );

    render(<MacroLibraryPanel />);

    await waitFor(() => expect(screen.getByText(/Couldn.t load macro library/i)).toBeInTheDocument());
    expect(screen.queryByText('Live')).not.toBeInTheDocument();
    expect(screen.queryByText('Compute')).not.toBeInTheDocument();
  });

  it('renders an honest error state on a non-ok HTTP response too', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: false, status: 500, json: async () => ({}) })),
    );

    render(<MacroLibraryPanel />);

    await waitFor(() => expect(screen.getByText(/Couldn.t load macro library/i)).toBeInTheDocument());
  });

  it('never renders actions that were not in the API response (no aspirational/hardcoded entries)', async () => {
    mockFetchOk({
      ok: true,
      domain: 'reason',
      total: 1,
      actions: [
        { action: 'verify', desc: null, brain: null, isAi: false, isGenerative: false, isAnalysis: false, isLive: false, isCompute: true },
      ],
    });

    render(<MacroLibraryPanel />);

    await waitFor(() => expect(screen.getByText('Verify')).toBeInTheDocument());
    // Nothing from other domains / hardcoded macro names should ever appear.
    expect(screen.queryByText(/naturalQuery/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/celestialPosition/i)).not.toBeInTheDocument();
  });

  it('defaults to the "reason" domain when no macro has run yet this session', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ ok: true, domain: 'reason', total: 0, actions: [] }),
    }));
    vi.stubGlobal('fetch', fetchMock);

    render(<MacroLibraryPanel />);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/lens-actions/reason'));
    expect(await screen.findByText(/No macros registered/i)).toBeInTheDocument();
  });
});
