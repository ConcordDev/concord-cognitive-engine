/**
 * Pins the /api/lens/run envelope-unwrap fix for EavesdropBubble (finding 29).
 *
 * Pre-fix, refresh() gated on top-level `data?.ok` and read `data.conversations`
 * off the top-level transport response. `npc.eavesdrop` returns
 * `{ ok, worldId, conversations }` as the macro payload nested at `.result` —
 * so the top-level `ok` gate always failed silently (`.result.ok` was the real
 * flag) and the bubble never appeared, even when the player stood right next
 * to an active NPC↔NPC conversation.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, act, waitFor } from '@testing-library/react';

vi.mock('@/lib/realtime/socket', () => ({ subscribe: () => () => {} }));

import EavesdropBubble from '@/components/world/EavesdropBubble';

const CONVERSATION = {
  id: 1,
  npc_a: 'npc-kael',
  npc_b: 'npc-orin',
  a_name: 'Kael',
  b_name: 'Orin',
  ax: 10, az: 10, bx: 11, bz: 10,
  messages_json: JSON.stringify([{ body: 'Did you hear about the dome?' }]),
};

function envelope(macroPayload: Record<string, unknown>) {
  return Promise.resolve({
    ok: true,
    json: () => Promise.resolve({ ok: true, result: macroPayload }),
  });
}

describe('EavesdropBubble — envelope unwrap (finding 29)', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(() => envelope({
      ok: true, worldId: 'concordia-hub', conversations: [CONVERSATION],
    })));
  });

  it('renders the bubble from result.conversations once the ok gate at result.ok passes', async () => {
    const { container } = render(
      <EavesdropBubble worldId="concordia-hub" playerPos={{ x: 10, z: 10 }} />,
    );
    await waitFor(() => expect(container.textContent).toMatch(/Kael ↔ Orin/));
    expect(container.textContent).toMatch(/Did you hear about the dome/);
  });

  it('renders nothing without a player position (no fetch fired)', () => {
    const { container } = render(<EavesdropBubble worldId="concordia-hub" />);
    expect(container.textContent).toBe('');
  });

  it('regression guard: a macro-level failure (result.ok=false) renders nothing even though transport ok=true', async () => {
    vi.stubGlobal('fetch', vi.fn(() => envelope({ ok: false, error: 'boom' })));
    const { container } = render(
      <EavesdropBubble worldId="concordia-hub" playerPos={{ x: 10, z: 10 }} />,
    );
    await act(async () => { await Promise.resolve(); });
    expect(container.textContent).toBe('');
  });
});
