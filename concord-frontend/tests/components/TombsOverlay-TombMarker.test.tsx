/**
 * Pins the /api/lens/run envelope-unwrap fix for the tomb surfaces
 * (findings 19-23).
 *
 * POST /api/lens/run always answers `{ ok: true, result: PAYLOAD }` at the
 * transport level — the outer `ok` only means "the call succeeded", not
 * that the macro itself succeeded. PAYLOAD (here `{ ok, tombs }` /
 * `{ ok, legacy }` / `{ ok, links }`) lives at `.result`. Both TombsOverlay
 * (a DOM panel) and TombMarker (the 3D obelisk mount) independently
 * duplicate the same two fetches (tombs_for_world + npc_legacy.get) rather
 * than sharing a helper, so both call sites are exercised here. TombsOverlay
 * additionally has its own inheritance_from_deceased fetch (InheritanceLog).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, act, waitFor } from '@testing-library/react';

// TombMarker is authored against react-three-fiber's <Canvas> (it returns
// <group>/<mesh> host elements and calls useFrame). We're not exercising
// real WebGL here — only the data-fetch → state-set contract — so useFrame
// is stubbed to a no-op the same way other R3F-authored components in this
// suite mock out their Canvas-only internals (see ForwardSimPanel.test.tsx).
vi.mock('@react-three/fiber', () => ({ useFrame: () => {} }));

// Capturing socket mock — lets a test fire the real `entity:death` event and
// assert both components' `subscribe('entity:death', ...)` handlers (not
// dead `window.addEventListener` calls) actually re-fetch.
vi.mock('@/lib/realtime/socket', () => {
  const listeners: Record<string, Array<(data: unknown) => void>> = {};
  return {
    subscribe: vi.fn((event: string, cb: (data: unknown) => void) => {
      (listeners[event] ||= []).push(cb);
      return () => {
        listeners[event] = (listeners[event] || []).filter((f) => f !== cb);
      };
    }),
    __emit: (event: string, data?: unknown) => {
      (listeners[event] || []).forEach((cb) => cb(data));
    },
  };
});

import TombsOverlay from '@/components/world/TombsOverlay';
import TombMarker from '@/components/world/TombMarker';
import * as socketMock from '@/lib/realtime/socket';

const emitSocket = (event: string, data?: unknown) =>
  (socketMock as unknown as { __emit: (e: string, d?: unknown) => void }).__emit(event, data);

const TOMB = {
  id: 'tomb-1',
  npc_id: 'npc-1',
  tomb_x: 3,
  tomb_z: 4,
  last_words: 'The dome will hold.',
  faction: 'sovereign-ruins',
  archetype: 'warrior',
  died_at: Date.now() - 60_000,
};

const LEGACY = {
  npc_id: 'npc-1',
  last_words: 'The dome will hold.',
  heirs_json: null,
  inherited_preoccupations_json: null,
  faction: 'sovereign-ruins',
  archetype: 'warrior',
  died_at: Date.now() - 60_000,
};

function envelope(macroPayload: Record<string, unknown>) {
  return Promise.resolve({
    ok: true,
    json: () => Promise.resolve({ ok: true, result: macroPayload }),
  });
}

/** Routes each /api/lens/run call to the right fixture by macro name. */
function fetchRouter() {
  return vi.fn((_url: string, init?: RequestInit) => {
    const body = JSON.parse((init?.body as string) || '{}');
    if (body.name === 'tombs_for_world') {
      return envelope({ ok: true, tombs: [TOMB], count: 1 });
    }
    if (body.name === 'get') {
      return envelope({ ok: true, legacy: LEGACY });
    }
    if (body.name === 'inheritance_from_deceased') {
      return envelope({
        ok: true,
        links: [{ id: 'lnk1', deceased_npc_id: 'npc-1', heir_npc_id: 'npc-2', heir_name: 'Vesper', inherited_kind: 'grudge', detail_json: null, inherited_at: Date.now() }],
      });
    }
    return envelope({ ok: false, reason: 'unknown_macro' });
  });
}

beforeEach(() => {
  vi.stubGlobal('fetch', fetchRouter());
});

describe('TombsOverlay — envelope unwrap (findings 19-21)', () => {
  it('renders the tombs panel from result.tombs (finding 19)', async () => {
    const { container } = render(<TombsOverlay worldId="concordia-hub" />);
    await waitFor(() => expect(container.textContent).toMatch(/Tombs — 1/));
  });

  it('clicking a tomb opens the legacy modal from result.legacy (finding 20)', async () => {
    const { container, getByText } = render(<TombsOverlay worldId="concordia-hub" />);
    await waitFor(() => expect(container.textContent).toMatch(/Tombs — 1/));
    // Expand the collapsed panel, then click the tomb row.
    await act(async () => { getByText(/Tombs — 1/).click(); });
    await act(async () => { getByText(/warrior/i).click(); });
    await waitFor(() => expect(getByText(/last words/i)).toBeTruthy());
    expect(container.textContent).toMatch(/The dome will hold\./);
  });

  it('renders the inheritance thread from result.links (finding 21)', async () => {
    const { container, getByText } = render(<TombsOverlay worldId="concordia-hub" />);
    await waitFor(() => expect(container.textContent).toMatch(/Tombs — 1/));
    await act(async () => { getByText(/Tombs — 1/).click(); });
    await act(async () => { getByText(/warrior/i).click(); });
    await waitFor(() => expect(container.textContent).toMatch(/Vesper/));
    expect(container.textContent).toMatch(/inherited a grudge/);
  });

  it('regression guard: a flat (unwrapped) response renders nothing', async () => {
    // Simulates the pre-fix bug shape one more time: if a future edit
    // reverts to reading top-level fields, tombs/legacy/links must NOT
    // populate from an envelope that only has `.result`.
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({
      ok: true,
      json: () => Promise.resolve({ ok: true, result: { ok: true, tombs: [TOMB] } }),
    })));
    // Reading top-level `data.tombs` (the bug) would see `undefined` here
    // because tombs only exists at `data.result.tombs` — the fixed code
    // must find it there, so this is really just confirming there's no
    // secondary top-level read path left in the component.
    const { container } = render(<TombsOverlay worldId="concordia-hub" />);
    await waitFor(() => expect(container.textContent).toMatch(/Tombs — 1/));
  });

  it('realtime: a real entity:death socket event refetches (was a dead window listener)', async () => {
    const fetchSpy = fetchRouter();
    vi.stubGlobal('fetch', fetchSpy);
    const { container } = render(<TombsOverlay worldId="concordia-hub" />);
    await waitFor(() => expect(container.textContent).toMatch(/Tombs — 1/));

    const callsAfterMount = fetchSpy.mock.calls.length;
    emitSocket('entity:death', { entityId: 'npc-2', entityName: 'Someone', cause: 'combat' });

    await waitFor(() => expect(fetchSpy.mock.calls.length).toBeGreaterThan(callsAfterMount));
  });
});

describe('TombMarker — envelope unwrap (findings 22-23)', () => {
  it('spawns a 3D marker per tomb from result.tombs (finding 22)', async () => {
    const { container } = render(<TombMarker worldId="concordia-hub" />);
    await waitFor(() => expect(container.querySelectorAll('group').length).toBe(1));
  });

  it('clicking a marker opens the legacy overlay from result.legacy (finding 23)', async () => {
    const { container } = render(<TombMarker worldId="concordia-hub" />);
    await waitFor(() => expect(container.querySelectorAll('group').length).toBe(1));
    const group = container.querySelector('group') as unknown as HTMLElement;
    await act(async () => { group.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
    await waitFor(() => expect(document.getElementById('concord-tomb-close')).toBeTruthy());
    expect(document.body.textContent).toMatch(/The dome will hold\./);
  });

  it('realtime: a real entity:death socket event refetches (was a dead window listener)', async () => {
    const fetchSpy = fetchRouter();
    vi.stubGlobal('fetch', fetchSpy);
    const { container } = render(<TombMarker worldId="concordia-hub" />);
    await waitFor(() => expect(container.querySelectorAll('group').length).toBe(1));

    const callsAfterMount = fetchSpy.mock.calls.length;
    emitSocket('entity:death', { entityId: 'npc-2', entityName: 'Someone', cause: 'combat' });

    await waitFor(() => expect(fetchSpy.mock.calls.length).toBeGreaterThan(callsAfterMount));
  });
});
