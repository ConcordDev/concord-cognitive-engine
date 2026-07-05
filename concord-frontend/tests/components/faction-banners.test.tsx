/**
 * Tier-2 frontend test for FactionBanners (finding #39).
 *
 * `factions.list_with_visual` fields live under the `/api/lens/run`
 * envelope's `.result`, not at the top level. The component used to read
 * `j.factions` directly off the raw response, so banners never resolved
 * a `visual` block and rendered nothing.
 */

import { describe, it, expect, vi, beforeAll, afterAll, afterEach } from 'vitest';
import { render, act } from '@testing-library/react';

import FactionBanners from '@/components/world/FactionBanners';

const CAMERA = { x: 0, y: 0, z: 0, yaw: 0, pitch: 0, fov: 1.0, width: 800, height: 600 };
const ANCHORS = [{ id: 'anchor-1', faction_id: 'faction-1', x: 0, y: 0, z: 10 }];

let originalRAF: typeof window.requestAnimationFrame;
let originalCAF: typeof window.cancelAnimationFrame;

beforeAll(() => {
  originalRAF = window.requestAnimationFrame;
  originalCAF = window.cancelAnimationFrame;
  window.requestAnimationFrame = vi.fn(() => 0) as unknown as typeof window.requestAnimationFrame;
  window.cancelAnimationFrame = vi.fn() as unknown as typeof window.cancelAnimationFrame;
});

afterAll(() => {
  window.requestAnimationFrame = originalRAF;
  window.cancelAnimationFrame = originalCAF;
});

describe('FactionBanners', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders a banner sigil sourced from the nested result payload', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({
      ok: true,
      json: () => Promise.resolve({
        ok: true,
        result: {
          ok: true,
          factions: [
            {
              id: 'faction-1',
              name: 'Ashen Concord',
              visual: {
                primary_color: '#333',
                secondary_color: '#111',
                accent_color: '#f00',
                sigil_path: 'M0,0 L1,1',
              },
            },
          ],
        },
      }),
    })));

    const { container, rerender } = render(
      <FactionBanners worldId="concordia-hub" bannerAnchors={ANCHORS} getCamera={() => CAMERA} />
    );

    // Flush the async fetch effect, then force a re-render so the component
    // reads the now-populated factionVisuals state.
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    rerender(<FactionBanners worldId="concordia-hub" bannerAnchors={ANCHORS} getCamera={() => CAMERA} />);

    // 2 paths per resolved banner: the cloth + the sigil.
    expect(container.querySelectorAll('path').length).toBe(2);
  });
});
