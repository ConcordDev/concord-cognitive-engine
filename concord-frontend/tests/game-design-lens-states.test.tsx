/**
 * /lenses/game-design — four-UX-state contract for the Game Design workbench.
 *
 * The lens page mounts <GameDesignSection/>, the real backend-driven surface
 * that owns the game roster + dashboard and hydrates every child panel through
 * lensRun('game-design', …). We pin that this surface renders genuine
 * loading / error (with a WORKING Retry that re-fetches) / empty / populated
 * states against its real backend channel: lensRun('game-design','game-list').
 *
 * Load-bearing wiring assertion: the surface drives the HYPHENATED 'game-design'
 * domain (the string the backend registers from server/domains/gamedesign.js) —
 * a regression to 'gamedesign' would resolve to NO receiver. We assert lensRun
 * was called with 'game-design'.
 *
 * Defect this pins (fixed in this pass): refreshGames previously had no
 * try/catch, so a thrown game-list left the section stuck on the spinner
 * forever (a silently-swallowed failure). The ERROR test proves the failure
 * now surfaces as role=alert + a working Retry that re-fetches and recovers.
 *
 * a11y: loading is role=status, error is role=alert. No fabricated data —
 * every state is driven by a mocked lensRun standing in for the real
 * /api/lens/run envelope ({ data: { ok, result } }).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, waitFor, act } from '@testing-library/react';
import React from 'react';

// ── backend channel: lensRun (POST /api/lens/run, unwrapped envelope) ───────
const lensRun = vi.fn();
vi.mock('@/lib/api/client', () => ({
  lensRun: (...a: unknown[]) => lensRun(...a),
}));

// Child panels each call lensRun on mount with the active game; stub them to
// inert nodes so the roster surface is isolated (they have their own coverage).
vi.mock('@/components/game-design/GdGddPanel', () => ({ GdGddPanel: () => null }));
vi.mock('@/components/game-design/GdMechanicsPanel', () => ({ GdMechanicsPanel: () => null }));
vi.mock('@/components/game-design/GdEntitiesPanel', () => ({ GdEntitiesPanel: () => null }));
vi.mock('@/components/game-design/GdLevelPanel', () => ({ GdLevelPanel: () => null }));
vi.mock('@/components/game-design/GdLoopsPanel', () => ({ GdLoopsPanel: () => null }));
vi.mock('@/components/game-design/GdNarrativePanel', () => ({ GdNarrativePanel: () => null }));
vi.mock('@/components/game-design/GdAssetsPanel', () => ({ GdAssetsPanel: () => null }));
vi.mock('@/components/game-design/GdAnimationPanel', () => ({ GdAnimationPanel: () => null }));
vi.mock('@/components/game-design/GdBehaviorPanel', () => ({ GdBehaviorPanel: () => null }));
vi.mock('@/components/game-design/GdRuntimePanel', () => ({ GdRuntimePanel: () => null }));
vi.mock('@/components/game-design/GdCollabPanel', () => ({ GdCollabPanel: () => null }));

import { GameDesignSection } from '@/components/game-design/GameDesignSection';

// The real /api/lens/run envelope shape after lensRun unwraps it.
const envelope = (result: unknown, ok = true) => ({ data: { ok, result, error: null } });
const GAME = { id: 'gam_1', title: 'Skybound', genre: 'platformer', platform: 'pc' };

// Route a lensRun call by action so list/dashboard/etc. each get a sane shape.
function dispatch(handlers: Record<string, () => unknown>) {
  return (_domain: string, action: string) => {
    const h = handlers[action];
    if (h) return Promise.resolve(h());
    // default: an ok envelope with an empty result for any other action.
    return Promise.resolve(envelope({}));
  };
}

beforeEach(() => {
  lensRun.mockReset();
});

describe('game-design section — wiring', () => {
  it('drives the HYPHENATED game-design domain on game-list', async () => {
    lensRun.mockImplementation(dispatch({ 'game-list': () => envelope({ games: [], count: 0 }) }));
    render(<GameDesignSection />);
    await waitFor(() => expect(lensRun).toHaveBeenCalledWith('game-design', 'game-list', expect.anything()));
    expect(lensRun).not.toHaveBeenCalledWith('gamedesign', 'game-list', expect.anything());
  });
});

describe('game-design section — four UX states', () => {
  it('LOADING: shows a role=status indicator while the game list is in flight', async () => {
    lensRun.mockImplementation(() => new Promise(() => {})); // never resolves
    const { container, getByText } = render(<GameDesignSection />);
    await waitFor(() => expect(container.querySelector('[role="status"]')).toBeTruthy());
    expect(getByText(/Loading game projects/i)).toBeInTheDocument();
  });

  it('EMPTY: shows the "Create a game project" CTA when the roster is empty', async () => {
    lensRun.mockImplementation(dispatch({ 'game-list': () => envelope({ games: [], count: 0 }) }));
    const { getByText } = render(<GameDesignSection />);
    await waitFor(() => expect(getByText(/Create a game project to start designing/i)).toBeInTheDocument());
  });

  it('ERROR: a failed game-list shows role=alert + a working Retry that re-fetches and recovers', async () => {
    let fail = true;
    lensRun.mockImplementation((domain: string, action: string) => {
      if (action === 'game-list') {
        if (fail) return Promise.reject(new Error('game service offline'));
        return Promise.resolve(envelope({ games: [GAME], count: 1 }));
      }
      if (action === 'game-dashboard') {
        return Promise.resolve(envelope({ title: 'Skybound', gddSections: 0, mechanics: 0, loops: 0, entities: 0, levels: 0, narrativeNodes: 0 }));
      }
      return Promise.resolve(envelope({}));
    });

    const { container, getByText } = render(<GameDesignSection />);
    await waitFor(() => expect(container.querySelector('[role="alert"]')).toBeTruthy());
    expect(getByText(/game service offline/i)).toBeInTheDocument();
    // the spinner is NOT stuck — the failure surfaced instead of hanging.
    expect(container.querySelector('[role="status"]')).toBeFalsy();

    const before = lensRun.mock.calls.filter((c) => c[1] === 'game-list').length;
    fail = false;
    await act(async () => { fireEvent.click(getByText('Retry')); });
    await waitFor(() =>
      expect(lensRun.mock.calls.filter((c) => c[1] === 'game-list').length).toBeGreaterThan(before),
    );
    // recovers to the populated roster.
    await waitFor(() => expect(getByText('Skybound')).toBeInTheDocument());
    expect(container.querySelector('[role="alert"]')).toBeFalsy();
  });

  it('POPULATED: renders the real game tab + dashboard stats from the backend', async () => {
    lensRun.mockImplementation(dispatch({
      'game-list': () => envelope({ games: [GAME], count: 1 }),
      'game-dashboard': () => envelope({ title: 'Skybound', gddSections: 2, mechanics: 5, loops: 1, entities: 3, levels: 4, narrativeNodes: 6 }),
    }));
    const { getByText, getAllByText } = render(<GameDesignSection />);
    await waitFor(() => expect(getByText('Skybound')).toBeInTheDocument());
    // dashboard stat labels render from the real dashboard payload.
    await waitFor(() => expect(getByText(/Mechanics/i)).toBeInTheDocument());
    // De-flake: the mechanics COUNT can paint a tick after its LABEL under CI
    // load, so retry rather than assert synchronously (was an intermittent
    // frontend_coverage failure in the loaded parallel run; passes 5/5 locally).
    await waitFor(() => expect(getAllByText('5').length).toBeGreaterThan(0)); // mechanics count
  });
});
