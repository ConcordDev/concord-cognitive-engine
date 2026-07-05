/**
 * Tier-2 frontend test for RefusalFieldHUD (finding #35).
 *
 * `callRefusalMacro` is the shared helper both this HUD's poll paths route
 * through. It used to resolve to the raw `/api/lens/run` envelope
 * (`{ ok: true, result: PAYLOAD }`) instead of unwrapping `.result`, so
 * `composition.strength` was always undefined and the HUD permanently
 * rendered null. Fixed once at the helper level.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, act } from '@testing-library/react';

vi.mock('@/lib/realtime/socket', () => ({
  subscribe: vi.fn(() => () => {}),
}));

import RefusalFieldHUD from '@/components/world/RefusalFieldHUD';

describe('RefusalFieldHUD', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders the strength pill from the nested result payload', async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({
        ok: true,
        result: {
          ok: true,
          worldId: 'concordia-hub',
          strength: 6.5,
          composedFrom: 2,
          glyph: { numerical: '⟐', semantic: 'refusal' },
          entries: [{ kind: 'hostility', strength: 4 }, { kind: 'death', strength: 2.5 }],
        },
      }),
    });

    const { container } = render(<RefusalFieldHUD worldId="concordia-hub" pollMs={100000} />);

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(container.textContent).toMatch(/RF 6\.5/);
    expect(container.textContent).toMatch(/COMPOUND/);
  });
});
