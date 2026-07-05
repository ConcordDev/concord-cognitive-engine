/**
 * Tier-2 frontend test for EmbodiedHUD (findings #33, #34).
 *
 * Two independent effects each call `/api/lens/run` directly (no shared
 * helper): one fetches `embodied.channels` (finding #33), the other
 * `embodied.signals_for_player` (finding #34). Both used to read fields
 * straight off the top-level response instead of `.result`, so the first
 * effect never populated `channels` (gating the second effect off
 * entirely) and the second never populated `signals` even when `channels`
 * was seeded directly.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, act } from '@testing-library/react';

import EmbodiedHUD from '@/components/world/EmbodiedHUD';

function jsonResponse(body: unknown) {
  return Promise.resolve({ ok: true, json: async () => body });
}

describe('EmbodiedHUD', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders channel readings sourced from the nested result payload', async () => {
    const fetchMock = vi.fn((_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body || '{}'));
      if (body.name === 'channels') {
        return jsonResponse({
          ok: true,
          result: {
            ok: true,
            channels: [{ id: 'thermal_os.ambient_temp', label: 'Temperature', unit: '°C' }],
          },
        });
      }
      if (body.name === 'signals_for_player') {
        return jsonResponse({
          ok: true,
          result: {
            ok: true,
            signals: { 'thermal_os.ambient_temp': 22 },
          },
        });
      }
      return jsonResponse({ ok: true, result: { ok: false } });
    });
    vi.stubGlobal('fetch', fetchMock);

    const { container } = render(<EmbodiedHUD />);

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(container.textContent).toMatch(/Temperature/);
    expect(container.textContent).toMatch(/22/);
  });
});
