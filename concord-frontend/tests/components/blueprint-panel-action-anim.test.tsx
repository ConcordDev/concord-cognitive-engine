// Animation-coverage audit (2026-07-21) — BlueprintPanel (workbench-based
// general crafting, POST /api/crafting/execute) had the exact same silent
// gap as CraftingPanelV2: a successful craft dispatched item-acquired/
// craft-success toast events but never touched the avatar. Fixed by mapping
// the crafted dtu.type onto the same labor-verb table CraftingPanelV2 uses.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, fireEvent, waitFor } from '@testing-library/react';
import { BlueprintPanel } from '@/components/concordia/crafting/BlueprintPanel';

const playActionAtPlayer = vi.fn();
vi.mock('@/lib/concordia/play-action', () => ({
  playActionAtPlayer: (...args: unknown[]) => playActionAtPlayer(...args),
}));

const apiGet = vi.fn();
const apiPost = vi.fn();
vi.mock('@/lib/api/client', () => ({
  api: { get: (...a: unknown[]) => apiGet(...a), post: (...a: unknown[]) => apiPost(...a) },
}));

// The minigame's own resolution UI is unrelated to this fix — stub it to a
// single button that calls onComplete with a fixed quality multiplier.
vi.mock('@/components/concordia/crafting/CraftingMinigame', () => ({
  CraftingMinigame: ({ onComplete }: { onComplete: (m: number) => void }) => (
    <button onClick={() => onComplete(1.0)}>finish-minigame</button>
  ),
}));

const BLUEPRINT = { id: 'bp1', title: 'Iron Helm', createdAt: new Date().toISOString(), requiredMaterials: [], requiredToolTier: 0 };

describe('BlueprintPanel — real avatar feedback on craft (not a silent panel)', () => {
  beforeEach(() => {
    playActionAtPlayer.mockClear();
    apiGet.mockImplementation((url: string) => {
      if (url === '/api/blueprints') return Promise.resolve({ data: { blueprints: [BLUEPRINT] } });
      if (url.startsWith('/api/blueprints/')) return Promise.resolve({ data: { blueprint: BLUEPRINT } });
      if (url === '/api/world/inventory') return Promise.resolve({ data: { items: [] } });
      return Promise.resolve({ data: {} });
    });
  });

  afterEach(() => { vi.clearAllMocks(); });

  it('plays the armor verb (dtu.type=armor) on a successful workbench craft', async () => {
    apiPost.mockResolvedValue({ data: { ok: true, dtu: { name: 'Iron Helm', type: 'armor' } } });

    const { getByText } = render(<BlueprintPanel playerId="u1" toolTier={0} skillLevel={1} onClose={() => {}} />);
    await waitFor(() => { expect(getByText('Iron Helm')).toBeTruthy(); });

    fireEvent.click(getByText('Iron Helm'));
    await waitFor(() => { expect(getByText('Begin Crafting')).toBeTruthy(); });
    fireEvent.click(getByText('Begin Crafting'));

    const finishBtn = await waitFor(() => getByText('finish-minigame'));
    fireEvent.click(finishBtn);

    await waitFor(() => { expect(playActionAtPlayer).toHaveBeenCalledWith('craft'); });
  });

  it('does not play an animation when the server rejects the craft', async () => {
    apiPost.mockResolvedValue({ data: { ok: false, error: 'Insufficient resources', missing_resources: [] } });

    const { getByText } = render(<BlueprintPanel playerId="u1" toolTier={0} skillLevel={1} onClose={() => {}} />);
    await waitFor(() => { expect(getByText('Iron Helm')).toBeTruthy(); });

    fireEvent.click(getByText('Iron Helm'));
    await waitFor(() => { expect(getByText('Begin Crafting')).toBeTruthy(); });
    fireEvent.click(getByText('Begin Crafting'));

    const finishBtn = await waitFor(() => getByText('finish-minigame'));
    fireEvent.click(finishBtn);

    await waitFor(() => { expect(getByText(/Need:/)).toBeTruthy(); });
    expect(playActionAtPlayer).not.toHaveBeenCalled();
  });
});
