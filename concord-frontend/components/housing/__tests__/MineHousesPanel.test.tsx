/**
 * MineHousesPanel — F1 / S-HO-1: claim creation is wired into the lens.
 * Review 3's first pass found the lifecycle PROBE-BLOCKED: the panel
 * could convert a building on claimed land, but at zero claims it
 * signposted a "Land Claims lens" that does not exist. The build adds
 * the claim-land form (the land_claims.claim macro the platform always
 * had); these tests pin the dead signpost's absence and the
 * building-anchored claim call.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MineHousesPanel } from '../MineHousesPanel';

const hoisted = vi.hoisted(() => ({
  claimCalls: [] as Array<{ worldId?: string; x?: number; z?: number; radiusM?: number }>,
}));

vi.mock('@/lib/api/client', () => ({
  lensRun: async (domain: string, action: string, params?: unknown) => {
    if (domain === 'land_claims' && action === 'list_for_user') {
      return { data: { ok: true, result: { ok: true, claims: [] } } };
    }
    if (domain === 'land_claims' && action === 'claim') {
      hoisted.claimCalls.push(params as { worldId?: string; x?: number; z?: number; radiusM?: number });
      return { data: { ok: true, result: { ok: true, claimId: 'lc_new' } } };
    }
    return { data: { ok: true, result: {} } };
  },
}));

describe('MineHousesPanel — claim creation (F1)', () => {
  beforeEach(() => {
    hoisted.claimCalls.length = 0;
    vi.stubGlobal('fetch', async (url: string) => {
      if (url.startsWith('/api/housing/mine')) {
        return { ok: true, json: async () => ({ ok: true, houses: [] }) };
      }
      if (url.startsWith('/api/worlds/tunya/buildings')) {
        return {
          ok: true,
          json: async () => ({
            ok: true,
            buildings: [{ id: 'wb1', world_id: 'tunya', name: 'Cottage', building_type: 'house', x: 100, y: 0, z: 200 }],
          }),
        };
      }
      return { ok: true, json: async () => ({ ok: true }) };
    });
  });

  it('at zero claims the panel offers claim creation — no dead Land Claims signpost', async () => {
    render(<MineHousesPanel flash={null} onFlash={() => {}} />);
    fireEvent.click(screen.getByTestId('housing-claim-toggle'));
    expect(await screen.findByTestId('housing-claim-land')).toBeTruthy();
    expect(screen.getByText(/No active land claims yet/)).toBeTruthy();
    expect(screen.queryByText('Land Claims')).toBeNull();
  });

  it('claiming land anchored on an existing building calls land_claims.claim at its coords', async () => {
    const onFlash = vi.fn();
    render(<MineHousesPanel flash={null} onFlash={onFlash} />);
    fireEvent.click(screen.getByTestId('housing-claim-toggle'));
    const row = await screen.findByText('Cottage');
    fireEvent.click(row.closest('button')!);
    await waitFor(() => expect(hoisted.claimCalls).toHaveLength(1));
    expect(hoisted.claimCalls[0]).toEqual({ worldId: 'tunya', x: 100, z: 200, radiusM: 25 });
    await waitFor(() => expect(onFlash).toHaveBeenCalledWith('ok', expect.stringContaining('Plot claimed')));
  });
});
