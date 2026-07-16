/// <reference types="@testing-library/jest-dom/vitest" />
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const lensRun = vi.fn();
vi.mock('@/lib/api/client', () => ({ lensRun: (...a: unknown[]) => lensRun(...a) }));

import { SizeScalingHUD } from './SizeScalingHUD';

function worldResponse(ruleModulators: Record<string, unknown>) {
  return Promise.resolve({
    ok: true,
    json: () => Promise.resolve({ world: { id: 'w1', rule_modulators: ruleModulators } }),
  } as Response);
}

const ok = <T,>(result: T) => ({ data: { ok: true, result } });

beforeEach(() => {
  lensRun.mockReset();
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe('SizeScalingHUD — Foundry config gating', () => {
  it('renders nothing for a world whose worldspec never selected size-scaling', async () => {
    global.fetch = vi.fn(() => worldResponse({ foundry: { systems: ['status-window'] } }));
    const { container } = render(<SizeScalingHUD worldId="w1" />);
    await waitFor(() => expect(global.fetch).toHaveBeenCalled());
    await waitFor(() => expect(container.firstChild).toBeNull());
    expect(lensRun).not.toHaveBeenCalled();
  });

  it('renders the real launcher + scale control respecting the world-configured min/max bounds', async () => {
    global.fetch = vi.fn(() =>
      worldResponse({
        foundry: { systems: ['size-scaling'] },
        size_scaling: { minScale: 10, maxScale: 500, smallGrantsFlight: true, largeGrantsDestruction: true },
      }),
    );
    lensRun.mockImplementation((_domain: string, action: string) => {
      if (action === 'get') {
        return Promise.resolve(ok({
          scale: 100,
          effects: { band: 'normal', scale: 100, multiplier: 1, canFly: false, canDestroy: false, stealthBonus: 0, reachBonus: 0 },
        }));
      }
      return Promise.reject(new Error(`unexpected action ${action}`));
    });

    render(<SizeScalingHUD worldId="w1" />);
    await waitFor(() => expect(screen.getByText('Size')).toBeInTheDocument());

    fireEvent.click(screen.getByText('Size'));
    await waitFor(() => expect(lensRun).toHaveBeenCalledWith('size', 'get', { worldId: 'w1' }));

    // Real config bounds surfaced, not hardcoded defaults.
    await waitFor(() => expect(screen.getByText('10%')).toBeInTheDocument());
    expect(screen.getByText('500%')).toBeInTheDocument();
    const slider = screen.getByLabelText('Requested scale percent') as HTMLInputElement;
    expect(slider.min).toBe('10');
    expect(slider.max).toBe('500');
  });

  it('applies a scale change via size.set and shows the real server-computed effects', async () => {
    global.fetch = vi.fn(() =>
      worldResponse({
        foundry: { systems: ['size-scaling'] },
        size_scaling: { minScale: 15, maxScale: 800 },
      }),
    );
    lensRun.mockImplementation((_domain: string, action: string) => {
      if (action === 'get') {
        return Promise.resolve(ok({
          scale: 100,
          effects: { band: 'normal', scale: 100, multiplier: 1, canFly: false, canDestroy: false, stealthBonus: 0, reachBonus: 0 },
        }));
      }
      if (action === 'set') {
        return Promise.resolve(ok({
          scale: 15,
          effects: { band: 'small', scale: 15, multiplier: 0.15, canFly: true, canDestroy: false, stealthBonus: 0.85, reachBonus: 0 },
          cost: 'stamina',
        }));
      }
      return Promise.reject(new Error(`unexpected action ${action}`));
    });

    render(<SizeScalingHUD worldId="w1" />);
    fireEvent.click(await screen.findByText('Size'));
    await waitFor(() => screen.getByText('Shrink'));

    fireEvent.click(screen.getByText('Shrink'));
    await waitFor(() =>
      expect(lensRun).toHaveBeenCalledWith('size', 'set', { worldId: 'w1', scale: 15 }),
    );

    await waitFor(() => expect(screen.getByText('Flight access granted')).toBeInTheDocument());
  });
});
