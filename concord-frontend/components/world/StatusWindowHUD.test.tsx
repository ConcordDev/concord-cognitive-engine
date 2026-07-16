/// <reference types="@testing-library/jest-dom/vitest" />
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const lensRun = vi.fn();
vi.mock('@/lib/api/client', () => ({ lensRun: (...a: unknown[]) => lensRun(...a) }));

import { StatusWindowHUD } from './StatusWindowHUD';

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

describe('StatusWindowHUD — Foundry config gating', () => {
  it('renders nothing at all for a world whose worldspec never selected status-window', async () => {
    global.fetch = vi.fn(() => worldResponse({ foundry: { systems: ['size-scaling'] } }));
    const { container } = render(<StatusWindowHUD worldId="w1" />);

    await waitFor(() => expect(global.fetch).toHaveBeenCalledWith('/api/worlds/w1', { credentials: 'include' }));
    // Give the disabled path a tick to settle, then confirm no launcher/panel.
    await waitFor(() => expect(container.firstChild).toBeNull());
    expect(lensRun).not.toHaveBeenCalled();
  });

  it('renders nothing when the world has no rule_modulators.foundry block at all (non-Foundry world)', async () => {
    global.fetch = vi.fn(() => worldResponse({}));
    const { container } = render(<StatusWindowHUD worldId="concordia-hub" />);
    await waitFor(() => expect(global.fetch).toHaveBeenCalled());
    await waitFor(() => expect(container.firstChild).toBeNull());
  });

  it('renders the real launcher + status/title panel for a world that selected status-window, using its configured style', async () => {
    global.fetch = vi.fn(() =>
      worldResponse({
        foundry: { systems: ['status-window'] },
        status_window: { style: 'sci-fi-hud', titleSystem: true },
      }),
    );
    lensRun.mockImplementation((_domain: string, action: string) => {
      if (action === 'window') {
        return Promise.resolve(ok({
          window: {
            style: 'sci-fi-hud',
            titles: ['Worldsmith', 'Dragonslayer'],
            activeTitle: 'Worldsmith',
            stats: {},
            skills: [],
            effects: [],
            inventoryCount: 0,
          },
        }));
      }
      return Promise.reject(new Error(`unexpected action ${action}`));
    });

    render(<StatusWindowHUD worldId="w1" />);
    await waitFor(() => expect(screen.getByText('Status')).toBeInTheDocument());

    fireEvent.click(screen.getByText('Status'));
    await waitFor(() => expect(lensRun).toHaveBeenCalledWith('status', 'window', { worldId: 'w1' }));

    await waitFor(() => expect(screen.getByText('STATUS.WND')).toBeInTheDocument());
    // "Worldsmith" is the active title — it appears both as the crown badge
    // and as the highlighted entry in the titles list.
    expect(screen.getAllByText('Worldsmith').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('Dragonslayer')).toBeInTheDocument();
  });
});
