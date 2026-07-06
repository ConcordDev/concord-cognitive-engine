// Phase CA6 — confirm CorpseMarker polls player corpses.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CorpseMarker } from '@/components/world/CorpseMarker';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FILE = path.resolve(__dirname, '..', 'components', 'world', 'CorpseMarker.tsx');

describe('Phase CA6 — Soulslike corpse marker', () => {
  const source = readFileSync(FILE, 'utf8');

  it('polls /api/players/me/corpses', () => {
    expect(source).toMatch(/\/api\/players\/me\/corpses/);
  });

  it('filters corpses to the current world', () => {
    expect(source).toMatch(/c\.world_id\s*===\s*worldId/);
  });

  it('sorts by distance + surfaces the closest', () => {
    expect(source).toMatch(/distance/);
    expect(source).toMatch(/sort/);
  });

  describe('rendered output', () => {
    afterEach(() => {
      cleanup();
      vi.unstubAllGlobals();
    });

    it('renders the lost coin count for the closest corpse', async () => {
      vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({
        ok: true,
        json: () => Promise.resolve({
          ok: true,
          corpses: [
            { id: 'c1', world_id: 'world-a', x: 0, y: 0, z: 0, coins_lost: 42, dropped_at: Date.now() },
            { id: 'c2', world_id: 'world-a', x: 100, y: 0, z: 100, coins_lost: 999, dropped_at: Date.now() },
          ],
        }),
      })));

      render(<CorpseMarker worldId="world-a" playerX={0} playerZ={0} />);

      await waitFor(() => expect(screen.getByText(/42 CC at corpse/)).toBeInTheDocument());
      // The farther corpse's coin count must NOT be the one shown — the
      // closest corpse (c1, distance 0) wins per the component's own sort.
      expect(screen.queryByText(/999 CC at corpse/)).not.toBeInTheDocument();
    });
  });
});
