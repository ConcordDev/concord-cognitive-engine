import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import React from 'react';

// LensShell wraps children in an a11y context provider that registers with a
// UI store; stub it to a plain pass-through so the page renders in isolation.
vi.mock('@/components/lens/LensShell', () => ({
  LensShell: ({ children }: React.PropsWithChildren) => React.createElement('div', null, children),
}));

import GarageLensPage from '@/app/lenses/garage/page';

const VEHICLES = {
  ok: true,
  vehicles: [
    { id: 'veh_a', world_id: 'concordia-hub', kind: 'cart', owner_kind: 'player', owner_id: 'driver1', capacity: 4, fare_cc: 0, pos_x: 5, pos_z: 3 },
    { id: 'veh_b', world_id: 'concordia-hub', kind: 'boat', owner_kind: 'none', capacity: 6, fare_cc: 0 },
  ],
};

function mockFetch(impl: (url: string, init?: RequestInit) => unknown) {
  global.fetch = vi.fn((url: string, init?: RequestInit) => {
    const r = impl(String(url), init);
    return Promise.resolve(r as Response);
  }) as unknown as typeof fetch;
}

function jsonResponse(body: unknown, ok = true, status = 200): Partial<Response> {
  return { ok, status, json: async () => body };
}

describe('GarageLensPage — four UX states', () => {
  beforeEach(() => {
    window.localStorage.setItem('concordia:activeWorldId', 'concordia-hub');
  });
  afterEach(() => { vi.restoreAllMocks(); });

  it('LOADING: shows a busy status before the fetch resolves', async () => {
    mockFetch(() => new Promise(() => {}) as unknown as Response);
    render(React.createElement(GarageLensPage));
    expect(await screen.findByRole('status')).toHaveTextContent(/loading/i);
  });

  it('POPULATED: renders the real vehicle list', async () => {
    mockFetch((url) => {
      if (url.includes('/api/garage/world/')) return jsonResponse(VEHICLES);
      return jsonResponse({ ok: true });
    });
    render(React.createElement(GarageLensPage));
    // The owner + capacity metadata is real, drawn from the row (unique text,
    // unlike the kind which also appears in the <select> options).
    expect(await screen.findByText(/cap 4 · fare 0 cc/)).toBeInTheDocument();
    expect(screen.getByText(/cap 6 · fare 0 cc/)).toBeInTheDocument();
    // The row renders the live position from the persisted vehicle.
    expect(screen.getByText(/\(5\.0, 3\.0\)/)).toBeInTheDocument();
    // Two list rows for two vehicles.
    expect(screen.getAllByRole('listitem')).toHaveLength(2);
  });

  it('EMPTY: honest empty state when the world has no vehicles', async () => {
    mockFetch((url) => {
      if (url.includes('/api/garage/world/')) return jsonResponse({ ok: true, vehicles: [] });
      return jsonResponse({ ok: true });
    });
    render(React.createElement(GarageLensPage));
    expect(await screen.findByText(/no vehicles in this world yet/i)).toBeInTheDocument();
  });

  it('ERROR: surfaces an honest error with a working retry', async () => {
    let attempt = 0;
    mockFetch((url) => {
      if (url.includes('/api/garage/world/')) {
        attempt += 1;
        if (attempt === 1) return jsonResponse({ ok: false }, false, 500);
        return jsonResponse(VEHICLES);
      }
      return jsonResponse({ ok: true });
    });
    render(React.createElement(GarageLensPage));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/couldn.t load garage data/i);
    // Retry recovers into the populated state.
    fireEvent.click(screen.getByText(/retry/i));
    await waitFor(() => expect(screen.getByText(/cap 4 · fare 0 cc/)).toBeInTheDocument());
  });

  it('SPAWN: only offers the real free-spawn archetypes (no fabricated kinds)', async () => {
    mockFetch((url) => {
      if (url.includes('/api/garage/world/')) return jsonResponse({ ok: true, vehicles: [] });
      return jsonResponse({ ok: true });
    });
    render(React.createElement(GarageLensPage));
    const spawnSelect = await screen.findByLabelText(/vehicle kind to spawn/i);
    const opts = Array.from(spawnSelect.querySelectorAll('option')).map((o) => o.getAttribute('value'));
    expect(opts).toEqual(['cart', 'boat']);
    // No fabricated kinds anywhere on the page.
    expect(screen.queryByText('horse')).not.toBeInTheDocument();
    expect(screen.queryByText('glider')).not.toBeInTheDocument();
  });

  it('SPAWN posts a player-owned vehicle then refreshes', async () => {
    const posted: RequestInit[] = [];
    mockFetch((url, init) => {
      if (url.includes('/api/garage/spawn')) {
        posted.push(init!);
        return jsonResponse({ ok: true, vehicleId: 'veh_new', kind: 'cart', capacity: 4, fare_cc: 0 });
      }
      if (url.includes('/api/garage/world/')) {
        return jsonResponse(posted.length === 0 ? { ok: true, vehicles: [] } : VEHICLES);
      }
      return jsonResponse({ ok: true });
    });
    render(React.createElement(GarageLensPage));
    await screen.findByText(/no vehicles in this world yet/i);
    fireEvent.click(screen.getByRole('button', { name: /spawn/i }));
    await waitFor(() => expect(screen.getByText(/cap 4 · fare 0 cc/)).toBeInTheDocument());
    expect(posted.length).toBe(1);
    expect(JSON.parse(posted[0].body as string)).toMatchObject({ kind: 'cart', ownerKind: 'player' });
  });
});
