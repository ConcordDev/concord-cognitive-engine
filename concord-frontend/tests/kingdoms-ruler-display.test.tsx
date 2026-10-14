/**
 * F1 — Detail / browse / resident UI renders display names, never raw uuids.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, screen, waitFor } from '@testing-library/react';
import React from 'react';

const RULER_UUID = '6f4308d5-039c-45ac-bd9c-254d0c498b0d';

const detailPayload = {
  ok: true,
  kingdom: {
    id: 'kdm_1',
    world_id: 'concordia-hub',
    name: 'Sweep realm',
    ruler_id: 'u_abcd1234ef00',
    ruler_display_name: 'Ada Ruler',
    ruler_faction_id: null,
    claim_strength: 50,
    founded_at: 1791985233,
    region_polygon: [[0, 0], [1, 0], [1, 1], [0, 1]],
  },
  decrees: [],
  residents: [
    { id: 'u_abcd1234ef00', display_name: 'Ada Ruler', role: 'ruler', joined_at: 1 },
    { id: 'u_citizen00001', display_name: 'Citizen X', role: 'citizen', joined_at: 2 },
  ],
};

const listPayload = {
  ok: true,
  kingdoms: [detailPayload.kingdom],
};

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo) => {
      const url = String(input);
      if (url.includes('/_meta/decree-kinds')) {
        return { ok: true, json: async () => ({ ok: true, kinds: {} }) } as Response;
      }
      if (url.match(/\/api\/kingdoms\/kdm_/)) {
        return { ok: true, json: async () => detailPayload } as Response;
      }
      if (url.includes('/api/kingdoms')) {
        return { ok: true, json: async () => listPayload } as Response;
      }
      return { ok: true, json: async () => ({ ok: true }) } as Response;
    }),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

import { KingdomDetailPanel } from '@/components/kingdoms/KingdomDetailPanel';
import { KingdomListPanel } from '@/components/kingdoms/KingdomListPanel';

describe('kingdoms F1 ruler display', () => {
  it('detail header and residents show display name, not uuid', async () => {
    render(<KingdomDetailPanel kingdomId="kdm_1" />);
    await waitFor(() => expect(screen.getByText('Sweep realm')).toBeTruthy());
    expect(screen.getAllByText('Ada Ruler').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('Citizen X')).toBeTruthy();
    expect(document.body.textContent).not.toContain(RULER_UUID);
    expect(document.body.textContent).not.toContain(RULER_UUID.slice(0, 12));
  });

  it('browse card shows display name, not uuid slice', async () => {
    render(<KingdomListPanel onPick={() => {}} />);
    await waitFor(() => expect(screen.getByText('Sweep realm')).toBeTruthy());
    expect(screen.getByText(/Ruler:\s*Ada Ruler/)).toBeTruthy();
    expect(document.body.textContent).not.toContain(RULER_UUID);
    expect(document.body.textContent).not.toContain(RULER_UUID.slice(0, 12));
  });
});
