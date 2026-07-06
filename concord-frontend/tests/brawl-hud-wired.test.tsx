// Phase DB2 — Brawl HUDs wiring tests.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BrawlInviteToast } from '@/components/world/BrawlInviteToast';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const HUD = path.resolve(__dirname, '..', 'components', 'world', 'BrawlInviteToast.tsx');
const WORLD = path.resolve(__dirname, '..', 'app', 'lenses', 'world', 'page.tsx');

describe('Phase DB2 — Brawl HUDs', () => {
  const src = readFileSync(HUD, 'utf8');

  it('toast listens for concordia:brawl-invited', () => {
    expect(src).toMatch(/concordia:brawl-invited/);
  });

  describe('accept/decline real fetch calls', () => {
    let fetchMock: ReturnType<typeof vi.fn>;

    beforeEach(() => {
      fetchMock = vi.fn((url: string) => {
        if (String(url).includes('/api/combat/brawl/invites')) {
          return Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true, invites: [] }) });
        }
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true }) });
      });
      vi.stubGlobal('fetch', fetchMock);
    });

    afterEach(() => {
      cleanup();
      vi.unstubAllGlobals();
    });

    function dispatchInvite(inviteId: string) {
      act(() => {
        window.dispatchEvent(new CustomEvent('concordia:brawl-invited', {
          detail: { inviteId, from: 'user_challenger', fromUserName: 'Challenger' },
        }));
      });
    }

    it('accept calls /api/combat/brawl/accept with the invite id', async () => {
      render(<BrawlInviteToast />);
      dispatchInvite('invite-1');
      const acceptBtn = await screen.findByText(/Accept/);
      await act(async () => { fireEvent.click(acceptBtn); });
      const acceptCall = fetchMock.mock.calls.find(([url]) => String(url).includes('/api/combat/brawl/accept'));
      expect(acceptCall).toBeTruthy();
      expect(acceptCall[1].body).toBe(JSON.stringify({ inviteId: 'invite-1' }));
    });

    it('decline calls /api/combat/brawl/decline with the invite id', async () => {
      render(<BrawlInviteToast />);
      dispatchInvite('invite-2');
      const declineBtn = await screen.findByText(/Decline/);
      await act(async () => { fireEvent.click(declineBtn); });
      const declineCall = fetchMock.mock.calls.find(([url]) => String(url).includes('/api/combat/brawl/decline'));
      expect(declineCall).toBeTruthy();
      expect(declineCall[1].body).toBe(JSON.stringify({ inviteId: 'invite-2' }));
    });
  });

  it('active HUD shows sifu_brawler profile + end button', () => {
    expect(src).toMatch(/sifu_brawler/);
    expect(src).toMatch(/\/api\/combat\/brawl\/end/);
  });

  it('mounted in world lens (both components)', () => {
    const w = readFileSync(WORLD, 'utf8');
    expect(w).toMatch(/BrawlInviteToast/);
    expect(w).toMatch(/BrawlActiveHUD/);
  });
});

// Fix (verification audit) — the REST backstop poll used to live inside
// BrawlActiveHUD, fetch /api/combat/brawl/invites, and discard the
// result (that component has no invite list to feed — it only tracks
// `active` brawl state). Moved to BrawlInviteToast, which owns the
// `invites` state the fetched data actually belongs to, and merged in
// via setInvites instead of being thrown away.
describe('Phase DB2 — brawl backstop refresh fix', () => {
  const src = readFileSync(HUD, 'utf8');

  it('BrawlInviteToast folds the REST backstop fetch into setInvites (not discarded)', () => {
    const toastStart = src.indexOf('export function BrawlInviteToast');
    const activeHudStart = src.indexOf('export function BrawlActiveHUD');
    expect(toastStart).toBeGreaterThanOrEqual(0);
    expect(activeHudStart).toBeGreaterThan(toastStart);
    const toastBody = src.slice(toastStart, activeHudStart);
    expect(toastBody).toMatch(/\/api\/combat\/brawl\/invites/);
    expect(toastBody).toMatch(/setInvites\(/);
  });

  it('BrawlActiveHUD no longer fetches and discards /api/combat/brawl/invites', () => {
    const activeHudStart = src.indexOf('export function BrawlActiveHUD');
    const activeHudBody = src.slice(activeHudStart);
    expect(activeHudBody).not.toMatch(/\/api\/combat\/brawl\/invites/);
  });

  it('BrawlActiveHUD still listens for concordia:brawl-started / concordia:brawl-ended', () => {
    const activeHudStart = src.indexOf('export function BrawlActiveHUD');
    const activeHudBody = src.slice(activeHudStart);
    expect(activeHudBody).toMatch(/concordia:brawl-started/);
    expect(activeHudBody).toMatch(/concordia:brawl-ended/);
  });
});

// Fix (verification audit) — useSocket.ts bridges the raw 'brawl-invited'
// and 'brawl-started' socket events (server-emitted names) onto the
// `concordia:`-namespaced window events these components actually listen
// for, since (unlike the existing 8-event same-name bridge) the names
// don't match 1:1.
describe('Phase DB2 — socket-to-window bridge for brawl events', () => {
  const USE_SOCKET = path.resolve(__dirname, '..', 'hooks', 'useSocket.ts');
  const SOCKET_TYPES = path.resolve(__dirname, '..', 'lib', 'realtime', 'socket.ts');
  const useSocketSrc = readFileSync(USE_SOCKET, 'utf8');
  const socketTypesSrc = readFileSync(SOCKET_TYPES, 'utf8');

  it('SocketEvent union includes brawl-invited and brawl-started', () => {
    expect(socketTypesSrc).toMatch(/\|\s*'brawl-invited'/);
    expect(socketTypesSrc).toMatch(/\|\s*'brawl-started'/);
  });

  it('useSocket forwards brawl-invited/brawl-started and registers them', () => {
    expect(useSocketSrc).toMatch(/'brawl-invited' as SocketEvent/);
    expect(useSocketSrc).toMatch(/'brawl-started' as SocketEvent/);
    expect(useSocketSrc).toMatch(/`concordia:\$\{event\}`/);
  });
});
