// DET-C dead-event fix — wager socket events wiring tests.
//
// server/routes/wagers.js emits 'wager:proposed'/'accepted'/'declined'/
// 'resolved' but (a) had a real bug where the 3rd realtimeEmit arg was a
// bare user-id string instead of the required `{ userId }` options object
// (silently broadcasting every wager globally instead of scoping to the
// intended participant), and (b) nothing on the frontend ever subscribed —
// IncomingWagerPrompt existed but was never mounted. This test pins both
// fixes.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MODAL = path.resolve(__dirname, '..', 'components', 'concordia', 'economy', 'WagerModal.tsx');
const WORLD = path.resolve(__dirname, '..', 'app', 'lenses', 'world', 'page.tsx');
const USE_SOCKET = path.resolve(__dirname, '..', 'hooks', 'useSocket.ts');
const SOCKET_TYPES = path.resolve(__dirname, '..', 'lib', 'realtime', 'socket.ts');
const WAGERS_ROUTE = path.resolve(__dirname, '..', '..', 'server', 'routes', 'wagers.js');

vi.mock('@/hooks/useAuth', () => ({
  useAuth: vi.fn(() => ({
    user: { id: 'user-me', username: 'me', email: 'me@test.com', role: 'user' },
    isLoading: false,
    isAuthenticated: true,
    logout: vi.fn(),
    refresh: vi.fn(),
  })),
}));

vi.mock('@/hooks/useRealtimeRefresh', () => ({
  useRealtimeRefresh: vi.fn(),
}));

const { apiPostMock } = vi.hoisted(() => ({
  apiPostMock: vi.fn(() => Promise.resolve({ data: { ok: true } })),
}));
vi.mock('@/lib/api/client', () => ({
  api: { post: apiPostMock, get: vi.fn(() => Promise.resolve({ data: { ok: true, wagers: [] } })) },
}));

import { WagerInviteToast } from '@/components/world/WagerInviteToast';

describe('DET-C — WagerInviteToast wiring', () => {
  describe('real render + accept/decline fetch calls', () => {
    beforeEach(() => {
      apiPostMock.mockClear();
      vi.stubGlobal('fetch', vi.fn(() =>
        Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true, wagers: [] }) })
      ));
    });

    afterEach(() => {
      cleanup();
      vi.unstubAllGlobals();
    });

    function dispatchProposed(wagerId: string) {
      act(() => {
        window.dispatchEvent(new CustomEvent('concordia:wager-proposed', {
          detail: {
            wagerId, proposerId: 'user-other', amount: 25, currency: 'sparks',
            duelType: 'combat', expiresAt: Date.now() + 60_000,
          },
        }));
      });
    }

    it('renders IncomingWagerPrompt on a real concordia:wager-proposed event', async () => {
      render(<WagerInviteToast />);
      dispatchProposed('wager-1');
      expect(await screen.findByText(/Challenge from user-other/)).toBeTruthy();
      expect(screen.getByText(/Accept/)).toBeTruthy();
      expect(screen.getByText(/Decline/)).toBeTruthy();
    });

    it('accept calls the real /api/wagers/:id/accept endpoint', async () => {
      render(<WagerInviteToast />);
      dispatchProposed('wager-2');
      const acceptBtn = await screen.findByText(/Accept/);
      await act(async () => { fireEvent.click(acceptBtn); });
      expect(apiPostMock).toHaveBeenCalledWith('/api/wagers/wager-2/accept');
    });

    it('decline calls the real /api/wagers/:id/decline endpoint', async () => {
      render(<WagerInviteToast />);
      dispatchProposed('wager-3');
      const declineBtn = await screen.findByText(/Decline/);
      await act(async () => { fireEvent.click(declineBtn); });
      expect(apiPostMock).toHaveBeenCalledWith('/api/wagers/wager-3/decline');
    });

    it('shows an outcome flash on concordia:wager-resolved for the winner', async () => {
      render(<WagerInviteToast />);
      act(() => {
        window.dispatchEvent(new CustomEvent('concordia:wager-resolved', {
          detail: { wagerId: 'wager-4', winnerId: 'user-me', payout: 48, currency: 'sparks' },
        }));
      });
      expect(await screen.findByText(/You won the wager/)).toBeTruthy();
    });

    it('shows an outcome flash on a real concordia:wager-accepted event', async () => {
      render(<WagerInviteToast />);
      act(() => {
        window.dispatchEvent(new CustomEvent('concordia:wager-accepted'));
      });
      expect(await screen.findByText(/Your wager was accepted/)).toBeTruthy();
    });

    it('shows an outcome flash on a real concordia:wager-declined event', async () => {
      render(<WagerInviteToast />);
      act(() => {
        window.dispatchEvent(new CustomEvent('concordia:wager-declined'));
      });
      expect(await screen.findByText(/Your wager was declined/)).toBeTruthy();
    });

    it('stacks two simultaneous prompts at distinct rendered offsets, neither nested inside the other', async () => {
      // Real proof that IncomingWagerPrompt instances stack via their own
      // stackIndex-derived inline offset (WagerModal.tsx `bottom: ${6 +
      // stackIndex * 8}rem`) rather than being wrapped in a single shared
      // `position: fixed` container div — a shared wrapper would collapse
      // every prompt onto the exact same screen position.
      render(<WagerInviteToast />);
      dispatchProposed('wager-a');
      dispatchProposed('wager-b');
      const prompts = await screen.findAllByText(/Challenge from user-other/);
      expect(prompts).toHaveLength(2);

      const fixedRoots = prompts.map((p) => p.closest('.fixed') as HTMLElement | null);
      expect(fixedRoots.every(Boolean)).toBe(true);
      // Neither prompt's fixed root contains the other — they're siblings,
      // not one nested inside a shared fixed wrapper.
      expect(fixedRoots[0]).not.toBe(fixedRoots[1]);
      expect(fixedRoots[0]!.contains(fixedRoots[1]!)).toBe(false);
      expect(fixedRoots[1]!.contains(fixedRoots[0]!)).toBe(false);
      // Each stackIndex produces a genuinely different rendered offset.
      const offsets = fixedRoots.map((r) => r!.style.bottom);
      expect(new Set(offsets).size).toBe(2);
    });
  });
});

describe('DET-C — WagerInviteToast mount-site source pin (page.tsx owned by another pass)', () => {
  it('world lens page.tsx source declares <WagerInviteToast /> (structural mount-site pin, not runtime-testable — page.tsx is a 9000+ line unmountable page)', () => {
    const w = readFileSync(WORLD, 'utf8');
    expect(w).toMatch(/WagerInviteToast/);
  });
});

describe('DET-C — WagerModal stackIndex prop (byte-identical default position)', () => {
  const src = readFileSync(MODAL, 'utf8');
  it('IncomingWagerPrompt defaults stackIndex to 0 (original bottom-24 position)', () => {
    expect(src).toMatch(/stackIndex\s*=\s*0/);
  });
});

describe('DET-C — socket-to-window bridge for wager events', () => {
  const useSocketSrc = readFileSync(USE_SOCKET, 'utf8');
  const socketTypesSrc = readFileSync(SOCKET_TYPES, 'utf8');

  it('SocketEvent union includes all four wager events', () => {
    expect(socketTypesSrc).toMatch(/\|\s*'wager:proposed'/);
    expect(socketTypesSrc).toMatch(/\|\s*'wager:accepted'/);
    expect(socketTypesSrc).toMatch(/\|\s*'wager:declined'/);
    expect(socketTypesSrc).toMatch(/\|\s*'wager:resolved'/);
  });

  it('useSocket forwards all four wager events and bridges them to concordia:wager-*', () => {
    expect(useSocketSrc).toMatch(/'wager:proposed' as SocketEvent/);
    expect(useSocketSrc).toMatch(/'wager:accepted' as SocketEvent/);
    expect(useSocketSrc).toMatch(/'wager:declined' as SocketEvent/);
    expect(useSocketSrc).toMatch(/'wager:resolved' as SocketEvent/);
    expect(useSocketSrc).toMatch(/`concordia:\$\{event\.replace\(':', '-'\)\}`/);
  });
});

describe('DET-C — server-side realtimeEmit targeting fix (routes/wagers.js)', () => {
  const src = readFileSync(WAGERS_ROUTE, 'utf8');

  it('propose/accept/decline/resolve all pass an options object, never a bare user id', () => {
    // The bug: realtimeEmit(event, payload, someBareUserIdString) silently
    // destructures to userId="" and falls through to a GLOBAL broadcast.
    // Every call site must pass `{ userId: ... }`.
    expect(src).toMatch(/realtimeEmit\?\.\("wager:proposed",[\s\S]*?\{\s*userId:\s*opponentId\s*\}\)/);
    expect(src).toMatch(/realtimeEmit\?\.\("wager:accepted",[\s\S]{0,80}\{\s*userId:\s*wager\.proposer_id\s*\}\)/);
    expect(src).toMatch(/realtimeEmit\?\.\("wager:declined",[\s\S]{0,80}\{\s*userId:\s*wager\.proposer_id\s*\}\)/);
    // Resolve fans out to both participants individually (never global).
    expect(src).toMatch(/realtimeEmit\?\.\("wager:resolved",\s*resolvedPayload,\s*\{\s*userId:\s*wager\.proposer_id\s*\}\)/);
    expect(src).toMatch(/realtimeEmit\?\.\("wager:resolved",\s*resolvedPayload,\s*\{\s*userId:\s*wager\.opponent_id\s*\}\)/);
  });

  it('wager realtimeEmit source lines never pass a bare identifier as the 3rd argument (structural regression pin)', () => {
    // Regression guard for the exact shape of the original bug:
    // `}, opponentId);` / `}, wager.proposer_id);` with no `{ userId: ... }`.
    // server/routes/wagers.js is out of scope to edit in this pass — this is
    // a deliberate static source-shape check, not a claim of exercised
    // runtime behavior (which the render tests above cover for the frontend
    // side of this same fix).
    expect(src).not.toMatch(/realtimeEmit\?\.\([^)]*\},\s*opponentId\)/);
    expect(src).not.toMatch(/realtimeEmit\?\.\([^)]*\},\s*wager\.proposer_id\)/);
  });
});
