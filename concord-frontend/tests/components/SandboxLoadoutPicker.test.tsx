import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';

// lensRun is the sole backend wire for the sandbox lens panels. We mock it so
// the four UX states (loading / error / empty / data) are exercised against the
// real component render path without a server boot.
const lensRun = vi.fn();
vi.mock('@/lib/api/client', () => ({
  lensRun: (...args: unknown[]) => lensRun(...args),
}));

vi.mock('lucide-react', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  const make = (name: string) => {
    const Icon = React.forwardRef<SVGSVGElement, Record<string, unknown>>((props, ref) =>
      React.createElement('span', { 'data-testid': `icon-${name}`, ref, ...props }),
    );
    Icon.displayName = name;
    return Icon;
  };
  const o: Record<string, unknown> = {};
  for (const k of Object.keys(actual)) {
    if (k[0] >= 'A' && k[0] <= 'Z' && k !== 'createLucideIcon' && k !== 'default') o[k] = make(k);
  }
  return { ...actual, ...o };
});

import { LoadoutPicker } from '@/components/sandbox/LoadoutPicker';

const CATALOG = {
  ok: true,
  result: {
    weapons: [{ id: 'fist', label: 'Fist', baseLight: 8, baseHeavy: 16, reach: 2, armorPierce: 0 }],
    skills: [{ id: 'none', label: 'No skill', element: 'physical', tier: 2 }],
    behaviors: [],
  },
};

function reply(payload: unknown) {
  return Promise.resolve({ data: { ...(payload as object), error: (payload as { error?: string }).error ?? null } });
}

beforeEach(() => {
  lensRun.mockReset();
});

describe('SandboxLoadoutPicker — four UX states + a11y', () => {
  it('1. LOADING: shows the loading affordance before catalog resolves', async () => {
    // Never-resolving promises keep the component in its loading state.
    lensRun.mockReturnValue(new Promise(() => {}));
    render(<LoadoutPicker onApply={() => {}} />);
    expect(await screen.findByText(/loading loadouts/i)).toBeTruthy();
    // a11y: the loading region announces politely.
    const busy = document.querySelector('[aria-busy="true"]');
    expect(busy).toBeTruthy();
  });

  it('2. EMPTY: catalog OK + zero saved loadouts → empty-state copy', async () => {
    lensRun.mockImplementation((_d: string, action: string) => {
      if (action === 'catalog') return reply(CATALOG);
      if (action === 'listLoadouts') return reply({ ok: true, result: { loadouts: [], count: 0 } });
      return reply({ ok: false });
    });
    render(<LoadoutPicker onApply={() => {}} />);
    expect(await screen.findByText(/no saved loadouts yet/i)).toBeTruthy();
    // a11y: the weapon/skill selects are labelled.
    expect(screen.getByLabelText(/weapon/i)).toBeTruthy();
    expect(screen.getByLabelText(/skill/i)).toBeTruthy();
  });

  it('3. DATA: a saved loadout renders its real persisted values', async () => {
    lensRun.mockImplementation((_d: string, action: string) => {
      if (action === 'catalog') return reply(CATALOG);
      if (action === 'listLoadouts')
        return reply({
          ok: true,
          result: {
            loadouts: [
              { id: 'ld_1', name: 'Glass cannon', weaponId: 'fist', skillId: 'none', lightDamage: 30, heavyDamage: 60, createdAt: '2026-01-01' },
            ],
            count: 1,
          },
        });
      return reply({ ok: false });
    });
    render(<LoadoutPicker onApply={() => {}} />);
    expect(await screen.findByText('Glass cannon')).toBeTruthy();
    // the persisted light/heavy values are shown, not fabricated.
    expect(screen.getByText(/30\/60/)).toBeTruthy();
    // a11y: the delete control is labelled, not an unlabelled icon button.
    expect(screen.getByLabelText(/delete loadout/i)).toBeTruthy();
  });

  it('4. ERROR: catalog failure surfaces an alert region', async () => {
    lensRun.mockImplementation((_d: string, action: string) => {
      if (action === 'catalog') return reply({ ok: false, result: null, error: 'state_unavailable' });
      return reply({ ok: false });
    });
    render(<LoadoutPicker onApply={() => {}} />);
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toMatch(/state_unavailable/i);
  });

  it('persists a new loadout through the real saveLoadout wire and refreshes', async () => {
    const saved: Array<Record<string, unknown>> = [];
    lensRun.mockImplementation((_d: string, action: string, input: Record<string, unknown>) => {
      if (action === 'catalog') return reply(CATALOG);
      if (action === 'listLoadouts') return reply({ ok: true, result: { loadouts: [...saved], count: saved.length } });
      if (action === 'saveLoadout') {
        saved.push({ id: 'ld_x', name: String(input.name) || 'Fist loadout', weaponId: 'fist', skillId: 'none', lightDamage: input.lightDamage, heavyDamage: input.heavyDamage });
        return reply({ ok: true, result: { loadout: saved[saved.length - 1], total: saved.length } });
      }
      return reply({ ok: false });
    });
    render(<LoadoutPicker onApply={() => {}} />);
    await screen.findByText(/no saved loadouts yet/i);
    fireEvent.change(screen.getByPlaceholderText(/preset name/i), { target: { value: 'My preset' } });
    fireEvent.click(screen.getByRole('button', { name: /save/i }));
    await waitFor(() => expect(screen.getByText('My preset')).toBeTruthy());
    expect(lensRun).toHaveBeenCalledWith('sandbox', 'saveLoadout', expect.objectContaining({ name: 'My preset', weaponId: 'fist' }));
  });
});
