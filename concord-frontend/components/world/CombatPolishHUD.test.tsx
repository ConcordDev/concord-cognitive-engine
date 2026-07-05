/// <reference types="@testing-library/jest-dom/vitest" />
// Pins the callMacro() helper's envelope-unwrap fix: /api/lens/run always
// responds { ok: true, result: PAYLOAD }; the helper must return PAYLOAD
// (combat_polish.state_for_actor -> { ok, state }), not the raw transport
// envelope, or `r.state` on the caller side is permanently undefined and
// the HUD never bootstraps.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

vi.mock('@/lib/realtime/socket', () => ({ subscribe: () => () => {} }));

import { CombatPolishHUD } from './CombatPolishHUD';

const STATE = {
  actor_kind: 'player' as const,
  actor_id: 'u-1',
  world_id: 'concordia-hub',
  profile_id: 'sifu_brawler',
  stance: 'high',
  posture: 'balanced',
  awareness: 'idle',
  awareness_target: null,
  gas: 80,
  max_gas: 100,
  combo_count: 0,
  combo_last_at_ms: 0,
  rocked_until_ms: 0,
  grapple_target: null,
  updated_at: Date.now(),
};

describe('CombatPolishHUD', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('bootstraps HUD state from the nested .result envelope', async () => {
    global.fetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({ ok: true, result: { ok: true, state: STATE } }),
    })) as unknown as typeof fetch;

    render(<CombatPolishHUD userId="u-1" />);

    await waitFor(() => {
      expect(screen.getByText(/SIFU/)).toBeInTheDocument();
    });
    expect(screen.getByText('80')).toBeInTheDocument();
  });

  it('renders nothing when there is no userId', () => {
    const { container } = render(<CombatPolishHUD userId={null} />);
    expect(container.firstChild).toBeNull();
  });
});
