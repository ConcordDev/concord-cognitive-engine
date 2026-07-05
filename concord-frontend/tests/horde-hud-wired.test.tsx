// Phase DB4 — Horde wave HUD wiring tests.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { HordeWaveHUD } from '@/components/world/HordeWaveHUD';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const HUD = path.resolve(__dirname, '..', 'components', 'world', 'HordeWaveHUD.tsx');
const WORLD = path.resolve(__dirname, '..', 'app', 'lenses', 'world', 'page.tsx');

describe('Phase DB4 — Horde wave HUD', () => {
  const src = readFileSync(HUD, 'utf8');

  it('polls /api/horde/active', () => {
    expect(src).toMatch(/\/api\/horde\/active/);
  });

  describe('real "Next wave" click', () => {
    afterEach(() => {
      cleanup();
      vi.unstubAllGlobals();
    });

    it('posts to /api/horde/:id/wave with the active run id', async () => {
      const fetchMock = vi.fn((url: string) => {
        if (String(url).includes('/api/horde/active')) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({
              ok: true,
              run: { id: 'run-77', world_id: 'w1', started_at: Date.now(), wave_reached: 3, kills: 12, score: 500, auto_attack: 0 },
            }),
          });
        }
        if (String(url).includes('/api/horde/run-77/wave')) {
          return Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true, upgradeChoices: [] }) });
        }
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true }) });
      });
      vi.stubGlobal('fetch', fetchMock);

      render(<HordeWaveHUD />);
      const nextWaveBtn = await screen.findByText('Next wave');
      fireEvent.click(nextWaveBtn);

      await waitFor(() => {
        const waveCall = fetchMock.mock.calls.find(([url]) => String(url).includes('/wave'));
        expect(waveCall).toBeTruthy();
        expect(waveCall![0]).toBe('/api/horde/run-77/wave');
      });
    });
  });

  it('upgrade pick posts to /api/horde/:id/upgrade', () => {
    expect(src).toMatch(/\/api\/horde\/\$\{[^}]+\}\/upgrade/);
  });

  it('end run posts to /api/horde/:id/end', () => {
    expect(src).toMatch(/\/api\/horde\/\$\{[^}]+\}\/end/);
  });

  it('surfaces wave / kills / score', () => {
    expect(src).toMatch(/wave/);
    expect(src).toMatch(/kills/);
    expect(src).toMatch(/score/);
  });

  it('upgrade picker reads upgradeChoices', () => {
    expect(src).toMatch(/upgradeChoices/);
  });

  it('mounted in world lens', () => {
    const w = readFileSync(WORLD, 'utf8');
    expect(w).toMatch(/HordeWaveHUD/);
    expect(w).toMatch(/<HordeWaveHUD/);
  });
});
