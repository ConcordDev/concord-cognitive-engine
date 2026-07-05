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
 *
 * Also pins findings 11-13: the legacy `npc_persona` packaging pipeline
 * (list_for_user / package / install) used to bypass `lensRun` with a raw
 * `fetch('/api/lens/run')` and read fields straight off the top-level JSON
 * body — which is always `{ ok: true, result: PAYLOAD }` (the transport
 * envelope), never the macro's own `{ ok, packages }` / `{ ok, dtuId }` /
 * `{ ok, importedNpcId, importedRows }` payload. Those call sites now route
 * through `lensRun` like the rest of the page, so the tests below mock
 * `lensRun` with the real nested-`result` shape and assert the fields
 * actually surface.
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
// The `/api/lens/run` transport envelope is always `{ ok: true, result: PAYLOAD }`
// where PAYLOAD is the macro's own `{ ok, ... }` shape — these helpers mirror
// what `lensRun()` (lib/api/client.ts) unwraps down to, i.e. what the page
// actually receives on `r.data.result`.
function pkgListOk(packages: unknown[]) {
  return Promise.resolve({ data: { ok: true, result: { ok: true, packages }, error: null } });
}
function packageOk(dtuId: string) {
  return Promise.resolve({ data: { ok: true, result: { ok: true, dtuId, sha256: 'deadbeef' }, error: null } });
}
// Mirrors what the real lensRun() resolves an `{ ok:false, error }` macro
// failure down to (result:null, error carried at the top).
function packageFail(error: string) {
  return Promise.resolve({ data: { ok: false, result: null, error } });
}
function installOk(importedNpcId: string, importedRows: number) {
  return Promise.resolve({ data: { ok: true, result: { ok: true, importedNpcId, importedRows }, error: null } });
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
  // Belt-and-suspenders: the page no longer calls raw fetch (the legacy
  // npc_persona packaging pipeline was migrated onto lensRun — findings
  // 11-13), but stub it inert in case any stray code path still reaches it.
  vi.stubGlobal('fetch', vi.fn(() =>
    Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ ok: true, result: { packages: [] } }) }),
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

describe('personas lens — NPC Packaging tab (findings 11-13: read fields off .result, not top-level)', () => {
  const PACKAGE_ROW = {
    id: 1,
    origin_npc_id: 'tully_vex',
    dtu_id: 'npc_persona:tully_vex:a1b2c3d4',
    package_sha256: '0123456789abcdef0123456789abcdef',
    created_at: 1700000000,
  };

  it('finding 11: lists packages from result.packages, not a top-level `packages` field', async () => {
    lensRunMock.mockImplementation((_d: string, action: string) => {
      if (action === 'mine') return mineOk([]);
      if (action === 'list_for_user') return pkgListOk([PACKAGE_ROW]);
      return mineOk([]);
    });
    const { getByText } = render(<PersonasPage />);
    await act(async () => { fireEvent.click(getByText('NPC Packaging')); });
    await waitFor(() => expect(getByText('tully_vex')).toBeInTheDocument());
    expect(() => getByText('No NPC packages yet.')).toThrow();
  });

  it('finding 11: an empty result.packages still renders the honest empty state', async () => {
    lensRunMock.mockImplementation((_d: string, action: string) => {
      if (action === 'mine') return mineOk([]);
      if (action === 'list_for_user') return pkgListOk([]);
      return mineOk([]);
    });
    const { getByText } = render(<PersonasPage />);
    await act(async () => { fireEvent.click(getByText('NPC Packaging')); });
    await waitFor(() => expect(getByText('No NPC packages yet.')).toBeInTheDocument());
  });

  it('finding 12: flashes the real dtuId from result.dtuId after a successful package', async () => {
    lensRunMock.mockImplementation((_d: string, action: string) => {
      if (action === 'mine') return mineOk([]);
      if (action === 'list_for_user') return pkgListOk([]);
      if (action === 'package') return packageOk('npc_persona:tully_vex:deadbeef');
      return mineOk([]);
    });
    const { getByText, getByPlaceholderText } = render(<PersonasPage />);
    await act(async () => { fireEvent.click(getByText('NPC Packaging')); });
    await waitFor(() => expect(getByText('No NPC packages yet.')).toBeInTheDocument());

    fireEvent.change(getByPlaceholderText('NPC id (e.g. tully_vex)'), { target: { value: 'tully_vex' } });
    await act(async () => { fireEvent.click(getByText('Package')); });

    await waitFor(() => expect(getByText('Packaged as npc_persona:tully_vex:deadbeef')).toBeInTheDocument());
    // pre-fix this read the top-level (always-undefined) `dtuId`, i.e. "Packaged as undefined".
    expect(() => getByText(/Packaged as undefined/)).toThrow();
  });

  it('finding 13: flashes the real importedNpcId/importedRows from result after a successful install', async () => {
    lensRunMock.mockImplementation((_d: string, action: string) => {
      if (action === 'mine') return mineOk([]);
      if (action === 'list_for_user') return pkgListOk([]);
      if (action === 'install') return installOk('npc_new_889', 42);
      return mineOk([]);
    });
    const { getByText, getByPlaceholderText } = render(<PersonasPage />);
    await act(async () => { fireEvent.click(getByText('NPC Packaging')); });
    await waitFor(() => expect(getByText('No NPC packages yet.')).toBeInTheDocument());

    fireEvent.change(getByPlaceholderText('DTU id'), { target: { value: 'npc_persona:tully_vex:deadbeef' } });
    await act(async () => { fireEvent.click(getByText('Install')); });

    await waitFor(() => expect(getByText('Installed as npc_new_889 (42 rows)')).toBeInTheDocument());
    // pre-fix this read top-level `importedNpcId`/`importedRows`, i.e. "Installed as undefined (undefined rows)".
    expect(() => getByText(/Installed as undefined/)).toThrow();
  });

  it('finding 12/13: a genuine failure surfaces the real error, not a silent success message', async () => {
    lensRunMock.mockImplementation((_d: string, action: string) => {
      if (action === 'mine') return mineOk([]);
      if (action === 'list_for_user') return pkgListOk([]);
      if (action === 'package') return packageFail('npc_not_found');
      return mineOk([]);
    });
    const { getByText, getByPlaceholderText } = render(<PersonasPage />);
    await act(async () => { fireEvent.click(getByText('NPC Packaging')); });
    await waitFor(() => expect(getByText('No NPC packages yet.')).toBeInTheDocument());

    fireEvent.change(getByPlaceholderText('NPC id (e.g. tully_vex)'), { target: { value: 'ghost_npc' } });
    await act(async () => { fireEvent.click(getByText('Package')); });

    await waitFor(() => expect(getByText(/Failed: npc_not_found/)).toBeInTheDocument());
  });
});
