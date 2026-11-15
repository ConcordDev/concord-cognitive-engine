import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

// FIX-sandbox-006 — selecting a saved loadout, changing Heavy dmg, and
// hitting Save created a SECOND preset: the picker never tracked which
// preset was loaded, and saveLoadout always created. Now loading a preset
// selects it, Save becomes Update and sends its loadoutId (the server
// updates in place), and "Save as new" is the explicit create path.

const lensRunMock = vi.fn();
vi.mock('@/lib/api/client', () => ({
  lensRun: (...args: unknown[]) => lensRunMock(...args),
}));

import { LoadoutPicker } from '@/components/sandbox/LoadoutPicker';

const preset = { id: 'ld_1', name: 'Duelist', weaponId: 'blade', skillId: 'none', lightDamage: 12, heavyDamage: 26, createdAt: '2026-11-10T00:00:00.000Z' };
let savedList = [preset];
const saveCalls: Record<string, unknown>[] = [];

beforeEach(() => {
  savedList = [preset];
  saveCalls.length = 0;
  lensRunMock.mockReset();
  lensRunMock.mockImplementation(async (_domain: string, action: string, params: Record<string, unknown> = {}) => {
    if (action === 'catalog') {
      return { data: { ok: true, result: {
        weapons: [{ id: 'blade', label: 'Blade', baseLight: 12, baseHeavy: 26, reach: 2.6, armorPierce: 1 }],
        skills: [{ id: 'none', label: 'No skill', element: 'physical', tier: 2 }],
      } } };
    }
    if (action === 'listLoadouts') return { data: { ok: true, result: { loadouts: savedList, count: savedList.length } } };
    if (action === 'saveLoadout') {
      saveCalls.push(params);
      const entry = { ...preset, name: (params.name as string) || preset.name, heavyDamage: params.heavyDamage as number, id: (params.loadoutId as string) || 'ld_new' };
      return { data: { ok: true, result: { loadout: entry, total: savedList.length } } };
    }
    return { data: { ok: true, result: {} } };
  });
});

function heavyInput(container: HTMLElement) {
  const inputs = container.querySelectorAll('input[type="number"]');
  return inputs[1] as HTMLInputElement; // [light, heavy]
}

describe('FIX-sandbox-006 — loadout preset edit', () => {
  it('loading a preset, changing Heavy dmg, and saving sends its loadoutId so the server updates it in place', async () => {
    const { container } = render(<LoadoutPicker onApply={() => {}} />);
    fireEvent.click(await screen.findByRole('button', { name: /^Duelist blade/ }));

    // The editor now shows the loaded preset's values and the Update affordance.
    expect(heavyInput(container).value).toBe('26');
    expect(await screen.findByRole('button', { name: 'Update' })).toBeTruthy();

    fireEvent.change(heavyInput(container), { target: { value: '40' } });
    fireEvent.click(screen.getByRole('button', { name: 'Update' }));

    await waitFor(() => expect(saveCalls.length).toBe(1));
    expect(saveCalls[0].loadoutId).toBe('ld_1');
    expect(saveCalls[0].heavyDamage).toBe(40);
  });

  it('"Save as new" is the explicit create path: no loadoutId is sent', async () => {
    render(<LoadoutPicker onApply={() => {}} />);
    fireEvent.click(await screen.findByRole('button', { name: /^Duelist blade/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'Save as new' }));

    await waitFor(() => expect(saveCalls.length).toBe(1));
    expect(saveCalls[0].loadoutId).toBeUndefined();
  });

  it('with nothing selected, Save stays a plain create (no loadoutId)', async () => {
    render(<LoadoutPicker onApply={() => {}} />);
    await screen.findByRole('button', { name: /^Duelist blade/ });
    fireEvent.change(screen.getByLabelText('Preset name'), { target: { value: 'Fresh' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(saveCalls.length).toBe(1));
    expect(saveCalls[0].loadoutId).toBeUndefined();
    expect(saveCalls[0].name).toBe('Fresh');
  });
});
