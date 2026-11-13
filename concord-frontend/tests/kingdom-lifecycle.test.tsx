// FIX-kingdoms-001 (FE) — the kingdom detail panel gains lifecycle
// controls: the ruler can rename (PATCH) and dissolve (two-step
// DELETE); before, the header offered only Join / a role badge.
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

vi.mock('@/components/kingdoms/WarCampaignSession', () => ({ WarCampaignSession: () => null }));

const calls: Array<{ url: string; method: string; body?: unknown }> = [];

const DETAIL = {
  ok: true,
  kingdom: {
    id: 'kdm_1', name: 'Old Name', world_id: 'w1', founded_at: 1762000000,
    ruler_display_name: 'Me', ruler_faction_id: null, region_polygon: [[0, 0], [1, 0], [1, 1]], claim_strength: 50,
  },
  decrees: [],
  residents: [{ id: 'res_1', display_name: 'Me', role: 'ruler' }],
  viewer: { resident: true, role: 'ruler' },
};

beforeEach(() => {
  calls.length = 0;
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: { method?: string; body?: string }) => {
    const method = init?.method || 'GET';
    calls.push({ url: String(url), method, body: init?.body ? JSON.parse(init.body) : undefined });
    if (String(url).includes('_meta/decree-kinds')) return { ok: true, json: async () => ({ ok: true, kinds: {} }) };
    if (method === 'GET') return { ok: true, json: async () => DETAIL };
    return { ok: true, json: async () => ({ ok: true, deleted: true }) };
  }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

import { KingdomDetailPanel } from '@/components/kingdoms/KingdomDetailPanel';

describe('kingdom detail lifecycle', () => {
  it('ruler renames via PATCH and dissolves via two-step DELETE', async () => {
    render(<KingdomDetailPanel kingdomId="kdm_1" />);
    await screen.findByText('Old Name', {}, { timeout: 3000 });
    await act(async () => { fireEvent.click(await screen.findByRole('button', { name: 'Rename kingdom' })); });
    const input = screen.getByLabelText('Kingdom name');
    await act(async () => { fireEvent.change(input, { target: { value: 'New Name' } }); });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Save name' })); });
    await waitFor(() => expect(calls.some((c) => c.method === 'PATCH' && (c.body as { name: string }).name === 'New Name')).toBe(true));

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Dissolve kingdom' })); });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Confirm dissolve' })); });
    await waitFor(() => expect(calls.some((c) => c.method === 'DELETE')).toBe(true));
    expect(await screen.findByText(/has been dissolved/)).toBeTruthy();
  });
});
