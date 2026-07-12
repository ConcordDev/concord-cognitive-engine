/// <reference types="@testing-library/jest-dom/vitest" />
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const lensRun = vi.fn();
vi.mock('@/lib/api/client', () => ({ lensRun: (...a: unknown[]) => lensRun(...a) }));
vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({ user: { id: 'u1', username: 'tester', email: '', role: 'user' }, isLoading: false, isAuthenticated: true }),
}));

import { DungeonHUD } from './DungeonHUD';

// Shape the lensRun envelope the same way the real client returns it.
const ok = <T,>(result: T) => ({ data: { ok: true, result } });
const fail = (result: unknown) => ({ data: { ok: false, result, error: null } });

function routeDungeon(handlers: Record<string, unknown | ((input: Record<string, unknown>) => unknown)>) {
  lensRun.mockImplementation((_domain: string, action: string, input: Record<string, unknown>) => {
    if (action in handlers) {
      const h = handlers[action];
      return Promise.resolve(typeof h === 'function' ? (h as (i: Record<string, unknown>) => unknown)(input) : h);
    }
    return Promise.reject(new Error(`unexpected action ${action}`));
  });
}

describe('DungeonHUD', () => {
  beforeEach(() => {
    lensRun.mockReset();
  });

  it('renders only the "Dungeons" launcher when the player has no active instance', async () => {
    routeDungeon({ active: ok({ instance: null }) });

    render(<DungeonHUD worldId="tunya" />);
    await waitFor(() => expect(lensRun).toHaveBeenCalledWith('dungeon', 'active', { worldId: 'tunya' }));
    expect(screen.getByText('Dungeons')).toBeInTheDocument();
    // No boss panel yet.
    expect(screen.queryByText('Strike')).not.toBeInTheDocument();
  });

  it('opens the encounter browser and lists real encounters with lockout state', async () => {
    routeDungeon({
      active: ok({ instance: null }),
      encounters: ok({
        encounters: [
          { id: 'hollow_warden', name: 'The Hollow Warden', baseHp: 4000, phases: [{}, {}, {}], lockoutH: 18 },
          { id: 'tide_colossus', name: 'Tide Colossus', baseHp: 6000, phases: [{}, {}, {}], lockoutH: 24 },
        ],
      }),
      lockouts: ok({ lockouts: [{ encounterId: 'tide_colossus', tier: 'finder', lockedUntil: Math.floor(Date.now() / 1000) + 3600 }] }),
    });

    render(<DungeonHUD worldId="tunya" />);
    await waitFor(() => expect(screen.getByText('Dungeons')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Dungeons'));

    await waitFor(() => expect(screen.getByText('The Hollow Warden')).toBeInTheDocument());
    expect(screen.getByText('Tide Colossus')).toBeInTheDocument();
    expect(screen.getByText('Start')).toBeInTheDocument();
    // The locked encounter shows a real lockout badge, not a plain Start button.
    expect(screen.getByText(/Locked \d+h/)).toBeInTheDocument();
  });

  it('starts an instance via dungeon.open and closes the browser', async () => {
    routeDungeon({
      active: ok({ instance: null }),
      encounters: ok({ encounters: [{ id: 'hollow_warden', name: 'The Hollow Warden', baseHp: 4000, phases: [{}], lockoutH: 18 }] }),
      lockouts: ok({ lockouts: [] }),
      open: ok({ instanceId: 'dng_1', boss: { name: 'The Hollow Warden', hp: 4000, maxHp: 4000, phase: 'guarded' } }),
    });

    render(<DungeonHUD worldId="tunya" />);
    fireEvent.click(await screen.findByText('Dungeons'));
    fireEvent.click(await screen.findByText('Start'));

    await waitFor(() =>
      expect(lensRun).toHaveBeenCalledWith('dungeon', 'open', { worldId: 'tunya', encounterId: 'hollow_warden', tier: 'finder' }),
    );
  });

  it('shows live boss hp%, phase, and real per-participant damage share', async () => {
    routeDungeon({
      active: ok({
        instance: {
          id: 'dng_1', world_id: 'tunya', leader_user: 'u1', encounter_id: 'hollow_warden', tier: 'finder',
          boss_name: 'The Hollow Warden', boss_hp: 2000, boss_max_hp: 4000, phase_idx: 1, phase_name: 'sundered',
          status: 'active',
          participants: [
            { user_id: 'u1', role: 'tank', damage_dealt: 1500, downed: 0, loot_json: null },
            { user_id: 'u2', role: 'dps', damage_dealt: 500, downed: 0, loot_json: null },
          ],
        },
      }),
    });

    render(<DungeonHUD worldId="tunya" />);
    await waitFor(() => expect(screen.getByText('The Hollow Warden')).toBeInTheDocument());
    expect(screen.getByText('sundered')).toBeInTheDocument();
    expect(screen.getByText('2,000 / 4,000 (50%)')).toBeInTheDocument();
    expect(screen.getByText('You')).toBeInTheDocument();
    expect(screen.getByText('1500 (75%)')).toBeInTheDocument();
    expect(screen.getByText('500 (25%)')).toBeInTheDocument();
    expect(screen.getByText('Strike')).toBeInTheDocument();
  });

  it('strikes via dungeon.hit and surfaces a rejected over-cap report as an error, not a fabricated hit', async () => {
    const activeInstance = {
      id: 'dng_1', world_id: 'tunya', leader_user: 'u1', encounter_id: 'hollow_warden', tier: 'finder',
      boss_name: 'The Hollow Warden', boss_hp: 4000, boss_max_hp: 4000, phase_idx: 0, phase_name: 'guarded',
      status: 'active',
      participants: [{ user_id: 'u1', role: 'tank', damage_dealt: 0, downed: 0, loot_json: null }],
    };
    routeDungeon({
      active: ok({ instance: activeInstance }),
      hit: () => fail({ reason: 'damage_cap_exceeded', cap: 500 }),
    });

    render(<DungeonHUD worldId="tunya" />);
    fireEvent.click(await screen.findByText('Strike'));

    await waitFor(() => expect(screen.getByText(/Attack failed: damage_cap_exceeded/)).toBeInTheDocument());
    // The hit call carried a client-rolled damage, but the HUD never invents
    // a "you hit for N" success — it only shows the server's real rejection.
    expect(lensRun).toHaveBeenCalledWith('dungeon', 'hit', expect.objectContaining({ instanceId: 'dng_1' }));
  });

  it('shows a real cleared-result banner (from dungeon.state) once the instance leaves active status', async () => {
    const activeInstance = {
      id: 'dng_1', world_id: 'tunya', leader_user: 'u1', encounter_id: 'hollow_warden', tier: 'finder',
      boss_name: 'The Hollow Warden', boss_hp: 10, boss_max_hp: 4000, phase_idx: 2, phase_name: 'desperate',
      status: 'active',
      participants: [{ user_id: 'u1', role: 'tank', damage_dealt: 3990, downed: 0, loot_json: null }],
    };
    const clearedInstance = {
      ...activeInstance, boss_hp: 0, status: 'cleared',
      participants: [{ user_id: 'u1', role: 'tank', damage_dealt: 4000, downed: 0, loot_json: JSON.stringify({ share: 1, rolls: 2 }) }],
    };

    let activeCalls = 0;
    routeDungeon({
      active: () => {
        activeCalls += 1;
        // First poll: still active. Second poll: it just cleared.
        return ok({ instance: activeCalls === 1 ? activeInstance : null });
      },
      state: ok({ instance: clearedInstance }),
    });

    render(<DungeonHUD worldId="tunya" pollMs={5} />);
    await waitFor(() => expect(screen.getByText('The Hollow Warden')).toBeInTheDocument());

    await waitFor(() => expect(screen.getByText('The Hollow Warden defeated')).toBeInTheDocument());
    expect(screen.getByText('Your share: 100% · 2 loot rolls')).toBeInTheDocument();

    fireEvent.click(screen.getByText('Dismiss'));
    await waitFor(() => expect(screen.queryByText('The Hollow Warden defeated')).not.toBeInTheDocument());
  });
});
