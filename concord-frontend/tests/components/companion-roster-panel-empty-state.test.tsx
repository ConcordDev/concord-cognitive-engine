/**
 * CompanionRosterPanel used to render its collapsed "Companions 0" pill
 * unconditionally — permanent bottom-right chrome for every player who
 * has never tamed a companion. It now returns null until the player has
 * at least one.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import React from 'react';

vi.mock('@/lib/realtime/socket', () => ({
  subscribe: vi.fn(() => () => {}),
}));

import { CompanionRosterPanel } from '@/components/world-lens/CompanionRosterPanel';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('CompanionRosterPanel — empty-state honesty', () => {
  it('renders nothing when the player has zero companions', async () => {
    vi.stubGlobal('fetch', vi.fn(() =>
      Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true, companions: [] }) }),
    ));
    const { container } = render(<CompanionRosterPanel worldId="concordia-hub" />);
    await waitFor(() => expect(container.firstChild).toBeNull());
    expect(screen.queryByText(/Companions/)).not.toBeInTheDocument();
  });

  it('renders the real roster pill once the player has at least one companion', async () => {
    vi.stubGlobal('fetch', vi.fn(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve({
          ok: true,
          companions: [{
            id: 'c1', owner_id: 'u1', creature_id: 'wolf', name: 'Fang',
            tame_bond: 0.5, loyalty: 0.5, level: 1, xp: 0, caught_at: 0,
            world_id: 'concordia-hub', deployed: 0,
          }],
        }),
      }),
    ));
    render(<CompanionRosterPanel worldId="concordia-hub" />);
    expect(await screen.findByText('Companions')).toBeInTheDocument();
    expect(await screen.findByText('1')).toBeInTheDocument();
  });
});
