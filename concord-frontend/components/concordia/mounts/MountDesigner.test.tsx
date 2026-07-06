/// <reference types="@testing-library/jest-dom/vitest" />
/**
 * MountDesigner — envelope-unwrap contract (finding 17).
 *
 * POST /api/lens/run ALWAYS answers `{ ok: true, result: PAYLOAD }` where the
 * outer `ok` is only a transport flag — PAYLOAD (each `mounts.*` macro's own
 * `{ ok, companions }` / `{ ok, speciesId, base, modifiers, effective }` /
 * `{ ok, gear }` / `{ ok, species }` / `{ ok, gait }` shape from
 * server/domains/mounts.js) carries the real success/failure + fields.
 * The component's local `runMacro()` helper used to return the raw fetch
 * body untouched, so `list.companions`, `s.speciesId`, `g.gear`,
 * `sp.species`, and `gp.gait` were all always `undefined` — the mount
 * list, stats panel, gear panel, and 3D preview were silently empty no
 * matter what the backend actually had.
 *
 * `runMacro()` now unwraps via `j?.result ?? j`. These tests mock global
 * fetch with the REAL nested envelope shape and assert each pane renders
 * from it.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, waitFor, fireEvent, act } from '@testing-library/react';

// Three.js/R3F preview is heavy + client-only; stub next/dynamic to a no-op.
vi.mock('next/dynamic', () => ({ default: () => () => null }));

import { MountDesigner } from './MountDesigner';

// `envelope()` mirrors the REAL /api/lens/run transport shape.
function envelope(macroResult: unknown) {
  return { ok: true, result: macroResult };
}
function jsonResponse(body: unknown) {
  return Promise.resolve({ ok: true, json: () => Promise.resolve(body) } as Response);
}

const COMPANION = { id: 'c-1', name: 'Dustmane', creature_id: 'sand-strider', level: 4, world_id: 'tunya' };

function routeMacros(handlers: Record<string, unknown>) {
  // @ts-expect-error test global
  global.fetch = vi.fn((_url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body));
    const key = body.name as string;
    if (key in handlers) return jsonResponse(envelope(handlers[key]));
    return jsonResponse(envelope({ ok: false, reason: `unhandled:${key}` }));
  });
}

beforeEach(() => { vi.clearAllMocks(); });
afterEach(() => { vi.restoreAllMocks(); });

describe('MountDesigner — envelope unwrap (finding 17)', () => {
  it('lists real companions from result.companions, not a top-level `companions` field', async () => {
    routeMacros({
      list_mountable: { ok: true, companions: [COMPANION] },
      compute_stats: { ok: false, reason: 'mount_not_found' },
      get_equipped_gear: { ok: false, reason: 'mount_not_found' },
    });
    const { getByText } = render(<MountDesigner />);
    await waitFor(() => expect(getByText('Dustmane')).toBeInTheDocument());
    expect(getByText(/lvl 4/)).toBeInTheDocument();
  });

  it('renders real stat cards from result.base/result.effective/result.modifiers, not top-level fields', async () => {
    routeMacros({
      list_mountable: { ok: true, companions: [COMPANION] },
      compute_stats: {
        ok: true,
        speciesId: 'sand-strider',
        base: { speedMps: 5, baseStamina: 100, carryCapacityKg: 50 },
        modifiers: { speed: 0.2, stamina: 0, carry: 0.1, comfort: 3 },
        effective: { speedMps: 6, baseStamina: 100, carryCapacityKg: 55, comfort: 3 },
      },
      get_equipped_gear: { ok: true, slots: ['saddle', 'bridle', 'barding'], gear: { saddle: null, bridle: null, barding: null } },
      get_species: { ok: true, species: { id: 'sand-strider' } },
      get_gait: { ok: true, gait: { id: 'sand-strider-gait' } },
    });
    const { getByText, container } = render(<MountDesigner />);
    await waitFor(() => expect(getByText('Dustmane')).toBeInTheDocument());
    // auto-selects the first companion, then fires compute_stats/get_equipped_gear.
    await waitFor(() => expect(getByText('6.00 m/s')).toBeInTheDocument());
    expect(getByText(/base 5.00 m\/s/)).toBeInTheDocument();
    // pre-fix `modifiers`/`base`/`effective` were always undefined, so these
    // panels never rendered at all (the `stats?.ok && stats.base` guards
    // never passed).
    expect(getByText(/Speed mod:/)).toHaveTextContent('+20%');
    expect(container.textContent).toMatch(/Carry mod:\s*\+10%/);
  });

  it('renders real equipped gear from result.gear, not a top-level `gear` field', async () => {
    routeMacros({
      list_mountable: { ok: true, companions: [COMPANION] },
      compute_stats: {
        ok: true,
        speciesId: 'sand-strider',
        base: { speedMps: 5, baseStamina: 100, carryCapacityKg: 50 },
        modifiers: { speed: 0, stamina: 0, carry: 0, comfort: 0 },
        effective: { speedMps: 5, baseStamina: 100, carryCapacityKg: 50, comfort: 0 },
      },
      get_equipped_gear: {
        ok: true,
        slots: ['saddle', 'bridle', 'barding'],
        gear: {
          saddle: { dtuId: 'mount_gear:saddle:abcdef123456', weight_kg: 4, stat_mods: { speed: 0.1 }, style_tags: [] },
          bridle: null,
          barding: null,
        },
      },
      get_species: { ok: true, species: { id: 'sand-strider' } },
      get_gait: { ok: true, gait: { id: 'sand-strider-gait' } },
    });
    const { getByText, container } = render(<MountDesigner />);
    await waitFor(() => expect(getByText('Dustmane')).toBeInTheDocument());
    // pre-fix `gear` was always undefined so the gear pane rendered nothing
    // but "Empty" for every slot. The saddle dtuId is truncated to 14 chars
    // in the UI (`slotData.dtuId.slice(0, 14)`), so match the prefix.
    await waitFor(() => expect(container.textContent).toMatch(/mount_gear:sad…/));
    expect(container.textContent).toMatch(/4\s*kg/);
  });

  it('species/gait feed the 3D preview lookup from result.species/result.gait, and unequip round-trips ok:true', async () => {
    let unequipCalled: Record<string, unknown> | null = null;
    routeMacros({
      list_mountable: { ok: true, companions: [COMPANION] },
      compute_stats: {
        ok: true,
        speciesId: 'sand-strider',
        base: { speedMps: 5, baseStamina: 100, carryCapacityKg: 50 },
        modifiers: { speed: 0, stamina: 0, carry: 0, comfort: 0 },
        effective: { speedMps: 5, baseStamina: 100, carryCapacityKg: 50, comfort: 0 },
      },
      get_equipped_gear: {
        ok: true,
        slots: ['saddle', 'bridle', 'barding'],
        gear: { saddle: { dtuId: 'mount_gear:saddle:abcdef123456', weight_kg: 4, stat_mods: {}, style_tags: [] }, bridle: null, barding: null },
      },
      get_species: { ok: true, species: { id: 'sand-strider' } },
      get_gait: { ok: true, gait: { id: 'sand-strider-gait' } },
      unequip_gear: { ok: true },
    });
    const { getByText, queryByText, container } = render(<MountDesigner />);
    await waitFor(() => expect(container.textContent).toMatch(/mount_gear:sad…/));

    // pre-fix `sp.species`/`gp.gait` were always undefined, so `species` and
    // `gaitProfile` state never populated and the preview pane was stuck on
    // the "Loading mount…" placeholder forever.
    await waitFor(() => expect(queryByText('Loading mount…')).toBeNull());

    // Unequip round-trips through the same unwrap (`{ ok: true }`, not
    // `{ ok: true, result: { ok: true } }` misread as failure).
    const originalFetch = global.fetch;
    // @ts-expect-error test global
    global.fetch = vi.fn((url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body));
      if (body.name === 'unequip_gear') { unequipCalled = body.input; return originalFetch(url, init); }
      return originalFetch(url, init);
    });
    await act(async () => { fireEvent.click(getByText('Unequip')); });
    await waitFor(() => expect(unequipCalled).toEqual({ mountId: 'c-1', slot: 'saddle' }));
  });
});
