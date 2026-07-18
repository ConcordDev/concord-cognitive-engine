/// <reference types="@testing-library/jest-dom/vitest" />
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const lensRun = vi.fn();
vi.mock('@/lib/api/client', () => ({ lensRun: (...a: unknown[]) => lensRun(...a) }));

import { ReincarnationPromptHUD } from './ReincarnationPromptHUD';

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

describe('ReincarnationPromptHUD — Foundry config gating', () => {
  it('renders nothing, even while dead, for a world whose worldspec never selected isekai-reincarnation', async () => {
    global.fetch = vi.fn(() => worldResponse({ foundry: { systems: ['size-scaling'] } }));
    const { container } = render(<ReincarnationPromptHUD worldId="w1" isDead={true} />);
    await waitFor(() => expect(global.fetch).toHaveBeenCalled());
    await waitFor(() => expect(container.firstChild).toBeNull());
    expect(lensRun).not.toHaveBeenCalled();
  });

  it('renders nothing when the system is selected but the world config sets enabled:false', async () => {
    global.fetch = vi.fn(() =>
      worldResponse({ foundry: { systems: ['isekai-reincarnation'] }, reincarnation: { enabled: false } }),
    );
    const { container } = render(<ReincarnationPromptHUD worldId="w1" isDead={true} />);
    await waitFor(() => expect(global.fetch).toHaveBeenCalled());
    await waitFor(() => expect(container.firstChild).toBeNull());
  });

  it('renders nothing while the player is alive, even in a world with the system enabled', async () => {
    global.fetch = vi.fn(() =>
      worldResponse({ foundry: { systems: ['isekai-reincarnation'] }, reincarnation: { enabled: true } }),
    );
    const { container } = render(<ReincarnationPromptHUD worldId="w1" isDead={false} />);
    await waitFor(() => expect(global.fetch).toHaveBeenCalled());
    expect(container.firstChild).toBeNull();
    expect(lensRun).not.toHaveBeenCalled();
  });

  it('shows the real prompt (with real prior-life count) once dead in a world that enabled it', async () => {
    global.fetch = vi.fn(() =>
      worldResponse({ foundry: { systems: ['isekai-reincarnation'] }, reincarnation: { enabled: true, inheritedFraction: 30 } }),
    );
    lensRun.mockImplementation((_domain: string, action: string) => {
      if (action === 'lives') {
        return Promise.resolve(ok({
          lives: [{ id: 'l1', lifeNumber: 2, priorAvatarId: null, inherited: { fraction: 0.3, memoryFragments: null }, reincarnatedAt: 1 }],
        }));
      }
      return Promise.reject(new Error(`unexpected action ${action}`));
    });

    render(<ReincarnationPromptHUD worldId="w1" isDead={true} />);
    await waitFor(() => expect(lensRun).toHaveBeenCalledWith('reincarnation', 'lives', { worldId: 'w1' }));
    await waitFor(() => expect(screen.getByText(/reincarnated 1 time before/)).toBeInTheDocument());
    expect(screen.getByText('Reincarnate')).toBeInTheDocument();
    expect(screen.getByText('Respawn normally instead')).toBeInTheDocument();
  });

  it('reincarnate calls the real macro with an honest empty priorState and shows the real ledger result', async () => {
    global.fetch = vi.fn(() =>
      worldResponse({ foundry: { systems: ['isekai-reincarnation'] }, reincarnation: { enabled: true } }),
    );
    lensRun.mockImplementation((_domain: string, action: string) => {
      if (action === 'lives') return Promise.resolve(ok({ lives: [] }));
      if (action === 'reincarnate') {
        return Promise.resolve(ok({
          lifeNumber: 2,
          inherited: { fraction: 0.2, memoryFragments: 'Fragments of life 1 linger.' },
        }));
      }
      return Promise.reject(new Error(`unexpected action ${action}`));
    });

    render(<ReincarnationPromptHUD worldId="w1" isDead={true} />);
    fireEvent.click(await screen.findByText('Reincarnate'));

    await waitFor(() =>
      expect(lensRun).toHaveBeenCalledWith('reincarnation', 'reincarnate', { worldId: 'w1', priorState: {} }),
    );
    await waitFor(() => expect(screen.getByText(/Life 2 begins/)).toBeInTheDocument());
    expect(screen.getByText('Fragments of life 1 linger.')).toBeInTheDocument();
    // No numeric progress was supplied, so none is fabricated in the result.
    expect(screen.getByText('No prior numeric progress was supplied to carry forward.')).toBeInTheDocument();
  });
});
