/**
 * /lenses/personas — four-UX-state contract.
 *
 * Pins that the Personas lens renders genuine loading / error (role=alert +
 * a working Retry) / empty / populated states for its primary load
 * (`personas.mine` via lensRun), plus a11y (loading is role=status, a load
 * failure is role=alert with a Retry that re-fetches).
 *
 * No fabricated data: every state is driven by a mocked `lensRun` standing in
 * for POST /api/lens/run, in exactly the { ok, result:{ personas:[...] } }
 * shape server/domains/personas.js returns (the backend the lens is built
 * against). The headless LensShell, cross-lens substrate children, and the
 * persona authoring/marketplace/detail components are render-only stubs so the
 * test stays on the page's own state machine.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, act, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';

// ── headless shell + lens substrate: render-only stubs ──────────────────────
vi.mock('@/components/lens/LensShell', () => ({
  LensShell: ({ children }: { children: React.ReactNode }) =>
    React.createElement('div', { 'data-testid': 'lens-shell' }, children),
}));
vi.mock('@/components/lens/RecentMineCard', () => ({ RecentMineCard: () => null }));
vi.mock('@/components/lens/AutoActionStrip', () => ({ AutoActionStrip: () => null }));
vi.mock('@/components/lens/CrossLensRecentsPanel', () => ({ CrossLensRecentsPanel: () => null }));
vi.mock('@/components/lens/FirstRunTour', () => ({ FirstRunTour: () => null }));
vi.mock('@/components/lens/DepthBadge', () => ({ DepthBadge: () => null }));
vi.mock('@/components/lens/LensVerticalHero', () => ({ LensVerticalHero: () => null }));
vi.mock('@/components/personas/CharacterStudio', () => ({ CharacterStudio: () => null }));
vi.mock('@/components/personas/PersonaEditor', () => ({ PersonaEditor: () => null }));
vi.mock('@/components/personas/PersonaMarketplace', () => ({ PersonaMarketplace: () => null }));
vi.mock('@/components/personas/PersonaDetailPanel', () => ({ PersonaDetailPanel: () => null }));
vi.mock('@/hooks/useLensCommand', () => ({ useLensCommand: () => {} }));

// ── lensRun mock: the page's primary load goes through this ──────────────────
const lensRunMock = vi.fn();
vi.mock('@/lib/api/client', () => ({
  lensRun: (...args: unknown[]) => lensRunMock(...args),
}));

// Import AFTER mocks are registered.
import PersonasPage from '@/app/lenses/personas/page';

function mineOk(personas: unknown[]) {
  return Promise.resolve({ data: { ok: true, result: { personas }, error: null } });
}
function mineErr(error: string) {
  return Promise.resolve({ data: { ok: false, result: null, error } });
}

const PERSONA = {
  id: 'persona_abc123',
  name: 'Cinder Vale',
  tagline: 'A weathered cartographer',
  category: 'guide',
  portrait: 'data:image/svg+xml;utf8,<svg/>',
  version: 2,
  published: true,
  installCount: 7,
};

beforeEach(() => {
  vi.unstubAllGlobals();
  lensRunMock.mockReset();
  // The page also fires a raw fetch for the legacy npc_persona packaging list;
  // keep it inert (empty package list) so we test only the personas.mine state
  // machine.
  vi.stubGlobal('fetch', vi.fn(() =>
    Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ ok: true, packages: [] }) }),
  ));
});

describe('personas lens — four UX states', () => {
  it('LOADING: shows a role=status indicator while personas.mine is in flight', async () => {
    // mine never resolves → page stays in the loading state.
    lensRunMock.mockImplementation((_d: string, action: string) =>
      action === 'mine' ? new Promise(() => {}) : mineOk([]));
    const { container } = render(<PersonasPage />);
    await waitFor(() => expect(container.querySelector('[role="status"]')).toBeTruthy());
    expect(container.querySelector('[role="status"]')?.textContent).toMatch(/loading/i);
  });

  it('ERROR: an ok:false mine response shows role=alert + a working Retry that re-fetches', async () => {
    let fail = true;
    lensRunMock.mockImplementation((_d: string, action: string) => {
      if (action !== 'mine') return mineOk([]);
      return fail ? mineErr('unknown_macro: personas.mine') : mineOk([PERSONA]);
    });
    const { container, getByText } = render(<PersonasPage />);

    await waitFor(() => expect(container.querySelector('[role="alert"]')).toBeTruthy());
    expect(container.querySelector('[role="alert"]')?.textContent).toMatch(/unknown_macro/i);
    // Honest failure: the empty-state CTA must NOT show when the load errored.
    expect(container.textContent).not.toMatch(/No personas yet/i);

    const mineCallsBefore = lensRunMock.mock.calls.filter((c) => c[1] === 'mine').length;
    fail = false;
    await act(async () => { fireEvent.click(getByText('Retry')); });
    await waitFor(() =>
      expect(lensRunMock.mock.calls.filter((c) => c[1] === 'mine').length)
        .toBeGreaterThan(mineCallsBefore));
    // recovers to the populated state
    await waitFor(() => expect(getByText('Cinder Vale')).toBeInTheDocument());
  });

  it('ERROR: a thrown mine call is treated as an honest load failure (no fake personas)', async () => {
    lensRunMock.mockImplementation((_d: string, action: string) =>
      action === 'mine' ? Promise.reject(new Error('network down')) : mineOk([]));
    const { container } = render(<PersonasPage />);
    await waitFor(() => expect(container.querySelector('[role="alert"]')).toBeTruthy());
    expect(container.querySelector('[role="alert"]')?.textContent).toMatch(/network down/i);
    expect(container.textContent).not.toMatch(/No personas yet/i);
  });

  it('EMPTY: shows the honest "No personas yet" CTA when the library is empty', async () => {
    lensRunMock.mockImplementation((_d: string, action: string) =>
      action === 'mine' ? mineOk([]) : mineOk([]));
    const { getByText, container } = render(<PersonasPage />);
    await waitFor(() => expect(getByText(/No personas yet/i)).toBeInTheDocument());
    // empty is NOT an error
    expect(container.querySelector('[role="alert"]')).toBeFalsy();
  });

  it('POPULATED: renders a real persona card (name + version/published/installs) from the backend row', async () => {
    lensRunMock.mockImplementation((_d: string, action: string) =>
      action === 'mine' ? mineOk([PERSONA]) : mineOk([]));
    const { getByText, container } = render(<PersonasPage />);
    await waitFor(() => expect(getByText('Cinder Vale')).toBeInTheDocument());

    // values come straight from the (mocked) backend row — not fabricated
    expect(getByText('A weathered cartographer')).toBeInTheDocument();
    expect(container.textContent).toMatch(/v2/);
    expect(container.textContent).toMatch(/published/);
    expect(container.textContent).toMatch(/7 installs/);
    // no loading / error states linger once populated
    expect(container.querySelector('[role="status"]')).toBeFalsy();
    expect(container.querySelector('[role="alert"]')).toBeFalsy();
  });
});
