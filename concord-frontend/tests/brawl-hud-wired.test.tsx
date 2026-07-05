// Phase DB2 — Brawl HUDs wiring tests.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const HUD = path.resolve(__dirname, '..', 'components', 'world', 'BrawlInviteToast.tsx');
const WORLD = path.resolve(__dirname, '..', 'app', 'lenses', 'world', 'page.tsx');

describe('Phase DB2 — Brawl HUDs', () => {
  const src = readFileSync(HUD, 'utf8');

  it('toast listens for concordia:brawl-invited', () => {
    expect(src).toMatch(/concordia:brawl-invited/);
  });

  it('accept calls /api/combat/brawl/accept', () => {
    expect(src).toMatch(/\/api\/combat\/brawl\/accept/);
  });

  it('decline calls /api/combat/brawl/decline', () => {
    expect(src).toMatch(/\/api\/combat\/brawl\/decline/);
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
