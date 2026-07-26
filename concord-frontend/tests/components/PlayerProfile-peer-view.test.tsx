import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

// V1.2 Wave A ("Society & Presence") capability 4 — reputation + citation
// graph. Pins the dead-wire fix end to end at the component level:
// `PlayerProfile` (the shared shell the self-view already used) now accepts
// a `targetUserId` prop and, when set, calls every `profile.*` macro with
// `{ targetUserId }` instead of the caller's own implicit id — the real
// backend `server/domains/profile.js` resolves that to a peer-safe view.
// This is the OTHER half of the fix (concord-frontend/tests/hooks/
// useViewedPlayerProfile.test.ts pins the event -> state half).
const lensRunMock = vi.fn();
vi.mock('@/lib/api/client', () => ({
  lensRun: (...args: unknown[]) => lensRunMock(...args),
}));

import PlayerProfile from '@/components/world-lens/PlayerProfile';

function resolveFor(byAction: Record<string, unknown>) {
  return (_domain: string, action: string) => {
    const result = byAction[action] ?? null;
    return Promise.resolve({ data: { ok: true, result, error: null } });
  };
}

beforeEach(() => {
  lensRunMock.mockReset();
});

describe('PlayerProfile — self view (backward compatible)', () => {
  it('fetches with EMPTY params (no targetUserId) and shows the Visitors tab', async () => {
    lensRunMock.mockImplementation(
      resolveFor({
        'profile-get': { profile: { id: 'me', displayName: 'Me', bio: '', profession: '', firmName: '', avatar: '', updatedAt: '2026-01-01T00:00:00Z' }, isSelf: true },
        'reputation-summary': { totalCitations: 0, totalRoyalties: 0, worldsOwned: 0, dtuCount: 0, reputation: [], isSelf: true },
        'badges-list': { badges: [], count: 0, isSelf: true },
        'portfolio-list': { portfolio: [], count: 0, isSelf: true },
        'visitors-list': { visitors: [], count: 0 },
      }),
    );

    render(<PlayerProfile isOwnProfile />);

    await waitFor(() => expect(screen.getByText('Me')).toBeInTheDocument());

    // Every profile.* call carries no targetUserId param — unchanged shape.
    for (const call of lensRunMock.mock.calls) {
      const [domain, action, params] = call as [string, string, Record<string, unknown>];
      expect(domain).toBe('profile');
      expect(params).toEqual({});
      void action;
    }
    // Self view fetches the visitor log too.
    expect(lensRunMock.mock.calls.some((c) => c[1] === 'visitors-list')).toBe(true);
    // Self view shows the Visitors tab.
    expect(screen.getByRole('button', { name: 'Visitors' })).toBeInTheDocument();
    // No Follow/Message action row on your own profile.
    expect(screen.queryByText('Follow')).not.toBeInTheDocument();
  });
});

describe('PlayerProfile — peer view (targetUserId) — the dead-wire fix', () => {
  it('fetches every profile.* macro WITH { targetUserId }, never fetches visitors-list, and renders the target (not the caller)', async () => {
    lensRunMock.mockImplementation(
      resolveFor({
        'profile-get': { profile: { id: 'player-42', displayName: 'Orin', bio: 'Ledger keeper.', profession: 'Auditor', firmName: '', avatar: '' }, isSelf: false },
        'reputation-summary': { totalCitations: 12, totalRoyalties: 0, worldsOwned: 1, dtuCount: 3, reputation: [{ domain: 'governance', score: 40 }], isSelf: false },
        'badges-list': { badges: [], count: 0, isSelf: false },
        'portfolio-list': { portfolio: [], count: 0, isSelf: false },
      }),
    );

    render(<PlayerProfile targetUserId="player-42" isOwnProfile />);
    // isOwnProfile=true is deliberately passed here to prove targetUserId
    // WINS regardless — the exact stale-prop-wiring bug this fix targets.

    await waitFor(() => expect(screen.getByText('Orin')).toBeInTheDocument());
    expect(screen.getByText('Ledger keeper.')).toBeInTheDocument();

    // Every call was scoped to the target, not the (irrelevant) caller.
    expect(lensRunMock.mock.calls.length).toBeGreaterThan(0);
    for (const call of lensRunMock.mock.calls) {
      const [domain, action, params] = call as [string, string, Record<string, unknown>];
      expect(domain).toBe('profile');
      expect(params).toEqual({ targetUserId: 'player-42' });
      void action;
    }
    // The private-surface visitors-list macro is never called for a peer view.
    expect(lensRunMock.mock.calls.some((c) => c[1] === 'visitors-list')).toBe(false);

    // Peer-view chrome: no Visitors tab, Follow/Message actions ARE shown.
    expect(screen.queryByRole('button', { name: 'Visitors' })).not.toBeInTheDocument();
    expect(screen.getByText('Follow')).toBeInTheDocument();
  });

  it('omitting targetUserId falls back to self view exactly as before (backward compatible)', async () => {
    lensRunMock.mockImplementation(
      resolveFor({
        'profile-get': { profile: { id: 'me', displayName: 'Me', bio: '', profession: '', firmName: '', avatar: '' }, isSelf: true },
        'reputation-summary': { totalCitations: 0, totalRoyalties: 0, worldsOwned: 0, dtuCount: 0, reputation: [], isSelf: true },
        'badges-list': { badges: [], count: 0, isSelf: true },
        'portfolio-list': { portfolio: [], count: 0, isSelf: true },
        'visitors-list': { visitors: [], count: 0 },
      }),
    );
    render(<PlayerProfile isOwnProfile />);
    await waitFor(() => expect(screen.getByText('Me')).toBeInTheDocument());
    for (const call of lensRunMock.mock.calls) {
      const params = call[2] as Record<string, unknown>;
      expect(params).toEqual({});
    }
  });
});
