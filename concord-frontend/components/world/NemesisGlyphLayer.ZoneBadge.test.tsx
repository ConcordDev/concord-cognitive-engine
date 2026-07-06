/// <reference types="@testing-library/jest-dom/vitest" />
// Pins the /api/lens/run envelope-unwrap fix for two simple render-from-list
// HUD components. The endpoint always responds { ok: true, result: PAYLOAD };
// reading fields off the top-level response (pre-fix) left them permanently
// undefined/empty:
//   - NemesisGlyphLayer read `j.npcs` instead of `j.result.npcs`.
//   - ZoneBadge read `data.zone` instead of `data.result.zone`.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, act, waitFor } from '@testing-library/react';

vi.mock('@/lib/realtime/socket', () => ({ subscribe: () => () => {} }));
vi.mock('@/hooks/useClientConfig', () => ({
  useClientConfig: () => ({ throttle: { nemesisFrameMs: 80 } }),
}));

import { NemesisGlyphLayer } from './NemesisGlyphLayer';
import ZoneBadge from './ZoneBadge';

type Projector = (w: { x: number; y: number; z: number }) => { x: number; y: number; visible: boolean } | null;

function dispatchProjector(stub: Projector) {
  act(() => {
    window.dispatchEvent(new CustomEvent('concordia:projector-ready', { detail: { project: stub } }));
  });
}

async function waitForFrame(ms = 200) {
  await new Promise((r) => setTimeout(r, ms));
}

describe('NemesisGlyphLayer', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('renders a glyph for an NPC nested under the .result envelope', async () => {
    global.fetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        ok: true,
        result: {
          ok: true,
          worldId: 'concordia-hub',
          npcs: [
            {
              npcId: 'npc-1',
              name: 'Kiren',
              x: 10,
              z: 10,
              grudge: 'never forgave the raid',
              preoccupation: null,
              desire: null,
              opinion: null,
              stress: null,
              scheme: null,
              isNemesis: true,
            },
          ],
          count: 1,
        },
      }),
    })) as unknown as typeof fetch;

    render(<NemesisGlyphLayer worldId="concordia-hub" playerPosition={{ x: 10, z: 10 }} />);

    await waitFor(() => expect(global.fetch).toHaveBeenCalled());
    dispatchProjector(() => ({ x: 100, y: 100, visible: true }));
    await waitForFrame();

    // Pre-fix, `rows` stayed empty forever (top-level `j.npcs` was undefined),
    // so no data-npc-id element would ever appear even with a live projector.
    const el = document.querySelector('[data-npc-id="npc-1"]');
    expect(el).not.toBeNull();
    expect(el?.getAttribute('data-nemesis')).toBe('true');
  });

  it('renders nothing when nemesis.nearby returns no rows', async () => {
    global.fetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({ ok: true, result: { ok: true, worldId: 'concordia-hub', npcs: [], count: 0 } }),
    })) as unknown as typeof fetch;

    render(<NemesisGlyphLayer worldId="concordia-hub" playerPosition={{ x: 10, z: 10 }} />);
    await waitFor(() => expect(global.fetch).toHaveBeenCalled());
    dispatchProjector(() => ({ x: 100, y: 100, visible: true }));
    await waitForFrame();
    expect(document.querySelector('[data-testid="nemesis-glyph-layer"]')).toBeNull();
  });
});

describe('ZoneBadge', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    (window as unknown as { __CONCORD_PLAYER_POS__?: { x: number; z: number } }).__CONCORD_PLAYER_POS__ = { x: 5, z: 5 };
  });

  it('renders the zone pill from the nested .result envelope', async () => {
    global.fetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        ok: true,
        result: { ok: true, zone: { name: 'Heartmere Sanctuary', kind: 'sanctuary' }, rule: {} },
      }),
    })) as unknown as typeof fetch;

    const { container } = render(<ZoneBadge worldId="concordia-hub" pollMs={100000} />);

    await waitFor(() => {
      expect(container.textContent).toMatch(/Heartmere Sanctuary/);
    });
    expect(container.textContent).toMatch(/Sanctuary/);
  });

  it('renders nothing when zones.at reports no governing zone', async () => {
    global.fetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({ ok: true, result: { ok: true, zone: null, rule: {} } }),
    })) as unknown as typeof fetch;

    const { container } = render(<ZoneBadge worldId="concordia-hub" pollMs={100000} />);
    await waitFor(() => expect(global.fetch).toHaveBeenCalled());
    expect(container.textContent).toBe('');
  });
});
