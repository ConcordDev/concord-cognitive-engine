/// <reference types="@testing-library/jest-dom/vitest" />
// Pins the LFGBoardPanel → server wiring fixed in the Wave 4 pass
// (docs/lens-specs/lfg-capability-map.md flagged the list fetch 404ing on a
// bare `/api/lfg` — the fix landed on `/api/lfg/open`, plus the post path
// `/api/lfg/post` and the real listOpenLfg camelCase row shape). These URLs
// and field names are contracts with server/server.js + server/lib/lfg.js —
// if either side drifts, this file goes red instead of the panel silently
// 404ing again.

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';

vi.mock('@/hooks/useRealtimeRefresh', async () => {
  const { useEffect } = await import('react');
  return {
    // Run the refresh callback once on mount (stand-in for the realtime
    // hook's initial backstop) so the list fetch actually fires in the test.
    useRealtimeRefresh: (_events: string[], cb: () => void, opts?: { enabled?: boolean }) => {
      useEffect(() => { if (opts?.enabled) cb(); }, [cb, opts?.enabled]);
    },
  };
});
vi.mock('@/lib/concordia/juice', () => ({
  successJuice: vi.fn(),
  failureJuice: vi.fn(),
}));

import { LFGBoardPanel } from '@/components/world/LFGBoardPanel';

const OPEN_ROW = {
  id: 'lfg_abc123',
  userId: 'user_1234567890abcdef',
  worldId: 'concordia-hub',
  role: 'tank',
  partyType: 'normal',
  partyMaxSize: 4,
  currentSize: 1,
  note: 'grinding the north quarry',
  createdAt: 1750000000,
};

function mockFetch(routes: Record<string, unknown>) {
  return vi.fn(async (url: string) => {
    const path = String(url).split('?')[0];
    if (path in routes) {
      return { json: async () => routes[path] } as Response;
    }
    // Anything else is a 404-shaped miss — exactly what the old bare
    // /api/lfg fetch used to hit in production.
    return { json: async () => ({ ok: false, error: 'not_found' }) } as Response;
  });
}

describe('LFGBoardPanel wiring', () => {
  beforeEach(() => {
    localStorage.setItem('concordia:activeWorldId', 'concordia-hub');
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  const openPanel = () => {
    act(() => { window.dispatchEvent(new CustomEvent('concordia:open-lfg-board')); });
  };

  it('lists open requests via GET /api/lfg/open and renders the real camelCase row shape', async () => {
    const fetchMock = mockFetch({ '/api/lfg/open': { ok: true, requests: [OPEN_ROW] } });
    vi.stubGlobal('fetch', fetchMock);

    render(<LFGBoardPanel />);
    openPanel();

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringMatching(/^\/api\/lfg\/open\?/),
        expect.objectContaining({ credentials: 'include' }),
      );
    });
    // Renders from the REAL listOpenLfg aliases (userId/currentSize/partyMaxSize),
    // not the old snake_case fields that crashed on `.slice` of undefined.
    expect(await screen.findByText('user_123456789')).toBeInTheDocument();
    expect(screen.getByText(/tank · 1\/4/)).toBeInTheDocument();
    expect(screen.getByText('grinding the north quarry')).toBeInTheDocument();
  });

  it('posts via POST /api/lfg/post with partyMaxSize (not the ignored partySize) and raid type above 8', async () => {
    const fetchMock = mockFetch({
      '/api/lfg/open': { ok: true, requests: [] },
      '/api/lfg/post': { ok: true, id: 'lfg_new' },
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<LFGBoardPanel />);
    openPanel();

    // Pick a raid-sized party (20 > 8) so the partyType contract is exercised.
    const sizeSelect = screen.getAllByRole('combobox')[1];
    fireEvent.change(sizeSelect, { target: { value: '20' } });
    fireEvent.click(screen.getByText(/Post LFG/));

    await waitFor(() => {
      const postCall = fetchMock.mock.calls.find(([u]) => String(u) === '/api/lfg/post');
      expect(postCall).toBeTruthy();
      const body = JSON.parse((postCall![1] as RequestInit).body as string);
      expect(body).toMatchObject({
        worldId: 'concordia-hub',
        partyMaxSize: 20,
        partyType: 'raid',
      });
      expect(body).not.toHaveProperty('partySize');
    });
  });

  it('never touches the dead bare /api/lfg endpoint', async () => {
    const fetchMock = mockFetch({
      '/api/lfg/open': { ok: true, requests: [] },
      '/api/lfg/post': { ok: true, id: 'lfg_new' },
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<LFGBoardPanel />);
    openPanel();
    fireEvent.click(screen.getByText(/Post LFG/));

    await waitFor(() => {
      expect(fetchMock.mock.calls.find(([u]) => String(u) === '/api/lfg/post')).toBeTruthy();
    });
    const bareCalls = fetchMock.mock.calls.filter(([u]) => /^\/api\/lfg(\?|$)/.test(String(u)));
    expect(bareCalls).toHaveLength(0);
  });
});
