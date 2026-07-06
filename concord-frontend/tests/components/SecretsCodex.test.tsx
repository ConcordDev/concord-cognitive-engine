/**
 * Pins the /api/lens/run envelope-unwrap fix for SecretsCodex (finding 25).
 *
 * Pre-fix, refresh() read `j?.secrets` off the top-level transport response
 * instead of `j.result.secrets` (`secrets.list_discovered` returns
 * `{ ok, secrets }` as the macro payload) — the codex always rendered its
 * "no secrets" empty state regardless of what the player had discovered.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, waitFor } from '@testing-library/react';

import SecretsCodex from '@/components/concordia/hud/SecretsCodex';

const SECRET = {
  id: 'sec-1',
  holder_npc_id: 'npc-kael',
  subject_kind: 'npc' as const,
  subject_id: 'npc-orin',
  kind: 'debt' as const,
  body: 'Orin owes the guild three hundred coin.',
  discovered_at: Math.floor(Date.now() / 1000),
  via: 'surveillance',
  weaponised_at: null,
  weaponised_against: null,
};

function envelope(macroPayload: Record<string, unknown>) {
  return Promise.resolve({
    ok: true,
    json: () => Promise.resolve({ ok: true, result: macroPayload }),
  });
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(() => envelope({ ok: true, secrets: [SECRET] })));
});

describe('SecretsCodex — envelope unwrap (finding 25)', () => {
  it('lists discovered secrets read from result.secrets', async () => {
    const { container } = render(<SecretsCodex open onClose={() => {}} />);
    await waitFor(() => expect(container.textContent).toMatch(/Orin owes the guild/));
    expect(container.textContent).toMatch(/Debt/);
    expect(container.textContent).not.toMatch(/have not yet uncovered/i);
  });

  it('renders nothing when closed', () => {
    const { container } = render(<SecretsCodex open={false} onClose={() => {}} />);
    expect(container.textContent).toBe('');
  });

  it('regression guard: a response with only `.result.secrets` (no top-level secrets) still populates', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({
      ok: true,
      json: () => Promise.resolve({ ok: true, result: { ok: true, secrets: [SECRET] } }),
    })));
    const { container } = render(<SecretsCodex open onClose={() => {}} />);
    await waitFor(() => expect(container.textContent).toMatch(/Orin owes the guild/));
  });
});
