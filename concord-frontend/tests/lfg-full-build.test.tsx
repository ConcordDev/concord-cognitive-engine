/**
 * LFG full build (B6) — the Lead compilation's two priced legs:
 *   S1 / F1 — the declaration, absent entire at the gate: REAL_LIVE on
 *   the manifest entry + the scoped badge caption (the board is the
 *   source, not an external poll).
 *   S2 / F2 — ownership on re-read: ownership was a session-only set of
 *   just-posted ids, so the first reload unmade the owner (YOU pill and
 *   Cancel gone, an Invite over the poster's own request, its refusal a
 *   raw code). The build reads ownership off the row's poster id
 *   against the signed-in account id, and refusals answer in words.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { renderHook } from '@testing-library/react';
import { getLensManifest } from '@/lib/lenses/manifest';
import { useDepthBadge } from '@/hooks/useDepthBadge';

vi.mock('@/hooks/useLensCommand', () => ({ useLensCommand: vi.fn() }));
vi.mock('@/components/lens/CrossLensRecentsPanel', () => ({ CrossLensRecentsPanel: () => null }));
vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({ user: { id: 'user_me_0001', username: 'tester' } }),
}));

import LfgLensPage from '@/app/lenses/lfg/page';

const realFetch = global.fetch;
afterEach(() => { global.fetch = realFetch; });

const MY_ROW = {
  id: 'lfg_mine', userId: 'user_me_0001', worldId: 'concordia-hub', role: 'support',
  partyType: 'normal', note: 'my standing request', createdAt: 1000, expiresAt: 9999999999,
  partyMaxSize: 8, currentSize: 1,
};
const THEIR_ROW = {
  id: 'lfg_theirs', userId: 'user_healer_0001', worldId: 'tunya', role: 'healer',
  partyType: 'normal', note: 'need 2 dps for harvest dungeon', createdAt: 1001, expiresAt: 9999999999,
  partyMaxSize: 8, currentSize: 1,
};

function stubFetch(inviteBody: unknown) {
  global.fetch = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    const u = typeof url === 'string' ? url : url.toString();
    if (u.includes('/invite')) {
      return { ok: true, status: 200, json: async () => inviteBody } as Response;
    }
    void init;
    return { ok: true, status: 200, json: async () => ({ ok: true, requests: [MY_ROW, THEIR_ROW] }) } as Response;
  }) as unknown as typeof fetch;
}

describe('LFG declaration (S1)', () => {
  it('the manifest entry declares REAL_LIVE', () => {
    expect(getLensManifest('lfg')?.dataTier).toBe('REAL_LIVE');
  });

  it('the badge reads Live with the scoped board caption', () => {
    const badge = renderHook(() => useDepthBadge('lfg')).result.current;
    expect(badge?.label).toBe('Live');
    expect(badge?.caption).toMatch(/read from the board itself/);
    expect(badge?.caption).not.toMatch(/external source/);
  });
});

describe('LFG ownership on re-read (S2)', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('a listing whose poster id is the signed-in account reads YOU + Cancel — never Invite — with no session post', async () => {
    stubFetch({ ok: true });
    render(<LfgLensPage />);
    expect(await screen.findByText('my standing request')).toBeTruthy();
    expect(screen.getByText('you')).toBeTruthy();
    expect(screen.getByRole('button', { name: /cancel your request/i })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /invite support from concordia-hub/i })).toBeNull();
    // The other poster's row keeps its Invite.
    expect(screen.getByRole('button', { name: /invite healer from tunya/i })).toBeTruthy();
  });

  it('a self-invite refusal answers in product words, never the raw code', async () => {
    stubFetch({ ok: false, error: 'cannot_invite_self' });
    render(<LfgLensPage />);
    expect(await screen.findByText('need 2 dps for harvest dungeon')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /invite healer from tunya/i }));
    await waitFor(() => {
      expect(screen.getByText(/That's your own request — you can't invite yourself\./)).toBeTruthy();
    });
    expect(screen.queryByText(/cannot_invite_self/)).toBeNull();
  });
});
