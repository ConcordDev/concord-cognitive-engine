/// <reference types="@testing-library/jest-dom/vitest" />
// Pins the land_claims.list_for_user read-path fix. /api/lens/run always
// responds { ok: true, result: PAYLOAD } (here PAYLOAD = { ok, claims }).
// The pre-fix code read `j?.data?.claims || j?.claims` — `j.data` never
// exists in the envelope shape at all, and `j.claims` is the un-nested
// top-level field, so the claim list was always empty and the factory
// editor could never be used.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

import { FactoryEditor } from './FactoryEditor';

const BUILDING = { id: 'b-1', building_type: 'factory_workbench', x: 0, z: 0, name: 'Factory workbench' };

function mockFetch(claims: Array<{ id: string; world_id: string; name?: string }>) {
  global.fetch = vi.fn(async (url: string, init?: RequestInit) => {
    if (url === '/api/lens/run') {
      const body = JSON.parse(String(init?.body || '{}'));
      if (body.domain === 'land_claims' && body.name === 'list_for_user') {
        return {
          ok: true,
          json: async () => ({ ok: true, result: { ok: true, claims } }),
        } as unknown as Response;
      }
    }
    if (typeof url === 'string' && url.startsWith('/api/factory/claim/')) {
      return { ok: true, json: async () => ({ ok: true, entities: [] }) } as unknown as Response;
    }
    return { ok: false, json: async () => ({ ok: false }) } as unknown as Response;
  }) as unknown as typeof fetch;
}

describe('FactoryEditor', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('lists claims read from the nested .result envelope', async () => {
    mockFetch([
      { id: 'claim-1', world_id: 'concordia-hub', name: 'My Claim' },
      { id: 'claim-2', world_id: 'concordia-hub', name: 'Other Claim' },
    ]);

    render(<FactoryEditor building={BUILDING} worldId="concordia-hub" onClose={() => {}} />);

    await waitFor(() => {
      expect(screen.getByText('My Claim')).toBeInTheDocument();
      expect(screen.getByText('Other Claim')).toBeInTheDocument();
    });
  });

  it('shows the no-claim empty state when the user owns no claims in this world', async () => {
    mockFetch([]);

    render(<FactoryEditor building={BUILDING} worldId="concordia-hub" onClose={() => {}} />);

    await waitFor(() => {
      expect(screen.getByText(/don't own a claim in this world/)).toBeInTheDocument();
    });
  });
});
