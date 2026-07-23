// Phase DA1 — NPC contextual action menu wiring tests.
//
// Verify at runtime that:
//   1. The menu listens for the right event.
//   2. The raycaster dispatches the new event name (not the old one).
//   3. The reachable action items actually render and respond to clicks.
//   4. The menu enriches via /api/mentors and /api/courtship.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor, act } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { NPCActionMenu } from '@/components/world/NPCActionMenu';
import { dispatchNpcContextMenuEvent } from '@/components/world-lens/ConcordiaScene';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MENU = path.resolve(__dirname, '..', 'components', 'world', 'NPCActionMenu.tsx');
const WORLD = path.resolve(__dirname, '..', 'app', 'lenses', 'world', 'page.tsx');

// Shared fixture: an /api/mentors/:id + /api/courtship/npc/:id + action-endpoint
// fetch mock, so the menu's async enrich() resolves isMentor/isCourtable true
// and every action button becomes clickable.
function makeFetchMock() {
  return vi.fn((url: unknown) => {
    const u = String(url);
    if (u.startsWith('/api/mentors/')) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true, profile: { id: 'npc-1' } }) });
    }
    if (u.startsWith('/api/courtship/npc/')) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true, eligible: true }) });
    }
    return Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true }) });
  });
}

function openMenu(occupation = 'Village Vendor') {
  act(() => {
    window.dispatchEvent(new CustomEvent('concordia:npc-context-menu', {
      detail: { npcId: 'npc-1', npcName: 'Test NPC', occupation, screenX: 100, screenY: 100 },
    }));
  });
}

describe('Phase DA1 — NPC contextual action menu', () => {
  it('NPCActionMenu listens for concordia:npc-context-menu', () => {
    const src = readFileSync(MENU, 'utf8');
    expect(src).toMatch(/addEventListener\(\s*['"]concordia:npc-context-menu['"]/);
  });

  it('Talk action forwards to concordia:open-dialogue (back-compat)', () => {
    const src = readFileSync(MENU, 'utf8');
    expect(src).toMatch(/dispatchEvent\(.*concordia:open-dialogue/s);
  });

  describe('rendered menu (real render + click)', () => {
    afterEach(() => {
      cleanup();
      vi.unstubAllGlobals();
    });

    it('renders 6 reachable action items (Talk, Mentor, Brawl, Court, Inspect, Trade); Hire never renders — isHirable is initialized false and nothing in the component ever sets it true', async () => {
      vi.stubGlobal('fetch', makeFetchMock());
      render(<NPCActionMenu />);
      openMenu('Village Vendor');

      // Synchronous base state: Talk/Brawl/Inspect always show; Trade shows
      // because the occupation regex (vendor|merchant|trader|shop) matches.
      expect(screen.getByText('Talk')).toBeDefined();
      expect(screen.getByText('Brawl invite')).toBeDefined();
      expect(screen.getByText('Inspect traits')).toBeDefined();
      expect(screen.getByText('Trade')).toBeDefined();

      // Mentor + Court only appear once the async enrich() resolves isMentor/isCourtable.
      await waitFor(() => {
        expect(screen.getByText('Request mentorship')).toBeDefined();
        expect(screen.getByText('Court')).toBeDefined();
      });

      // Hire is dead code in the current implementation: `isHirable` is set
      // to `false` in the base state and `enrich()` never returns a value for
      // it, so `menu.isHirable` can never be true and the Hire <MenuItem> can
      // never render, regardless of NPC state. This is a genuine gap (the
      // header comment's "Hire if /api/jobs/listing-for-npc returns a row"
      // was never implemented) — not something this test should paper over.
      expect(screen.queryByText('Hire')).toBeNull();
    });

    it('action items call the right endpoints with the right payload', async () => {
      const fetchMock = makeFetchMock();
      vi.stubGlobal('fetch', fetchMock);
      render(<NPCActionMenu />);

      // Mentor.
      openMenu();
      fireEvent.click(await screen.findByText('Request mentorship'));
      await waitFor(() => {
        const call = fetchMock.mock.calls.find(([url]) => url === '/api/mentorship/request');
        expect(call).toBeTruthy();
        const [, opts] = call as [string, RequestInit];
        expect(opts.method).toBe('POST');
        expect(JSON.parse(opts.body as string)).toEqual({ mentorNpcId: 'npc-1' });
      });

      // Brawl (always visible, no enrich wait needed).
      openMenu();
      fireEvent.click(await screen.findByText('Brawl invite'));
      await waitFor(() => {
        const call = fetchMock.mock.calls.find(([url]) => url === '/api/combat/brawl/invite');
        expect(call).toBeTruthy();
        const [, opts] = call as [string, RequestInit];
        expect(opts.method).toBe('POST');
        expect(JSON.parse(opts.body as string)).toEqual({ toUserId: 'npc-1' });
      });

      // Court.
      openMenu();
      fireEvent.click(await screen.findByText('Court'));
      await waitFor(() => {
        const call = fetchMock.mock.calls.find(([url]) => url === '/api/courtship/interact');
        expect(call).toBeTruthy();
        const [, opts] = call as [string, RequestInit];
        expect(opts.method).toBe('POST');
        expect(JSON.parse(opts.body as string)).toEqual({ partnerKind: 'npc', partnerId: 'npc-1', sentiment: 1 });
      });
    });
  });

  it('enrich() polls /api/mentors and /api/courtship for conditional surface', () => {
    const src = readFileSync(MENU, 'utf8');
    expect(src).toMatch(/\/api\/mentors\//);
    expect(src).toMatch(/\/api\/courtship\/npc\//);
  });

  // The two tests below used to be source-string pins only. Investigated:
  // the dispatch lives inside `handleCanvasClick` in ConcordiaScene.tsx,
  // gated behind a real THREE.Raycaster hit-test against
  // `avatarsGroup.children` (actual mesh geometry built by AvatarSystem3D,
  // with real camera/scene refs populated in a large `useEffect`) — there's
  // no way to exercise the HIT-TEST itself without a real WebGL context,
  // matching the precedent in avatar-scar-render.test.tsx and
  // avatar-system-worker-wired.test.tsx. But the actual EVENT DISPATCH the
  // hit-test calls once it resolves a hit was a one-line inline
  // `window.dispatchEvent(new CustomEvent(...))` with no seam at all — so it
  // has been pulled out into a small, real, exported function
  // (`dispatchNpcContextMenuEvent`, ConcordiaScene.tsx) with byte-identical
  // behavior to what was inline before. These tests now call THAT function —
  // the literal code the raycaster hit-test invokes — directly, and assert
  // on NPCActionMenu (a real listener) actually reacting to it, rather than
  // regexing the source text.
  describe('ConcordiaScene → NPCActionMenu real dispatch (via the extracted seam)', () => {
    afterEach(() => {
      cleanup();
      vi.unstubAllGlobals();
    });

    it('ConcordiaScene raycaster dispatches concordia:npc-context-menu (not the old open-dialogue path)', async () => {
      vi.stubGlobal('fetch', makeFetchMock());
      render(<NPCActionMenu />);

      // Negative control: the pre-DA1 code opened dialogue by dispatching
      // `concordia:open-dialogue` directly on NPC click. NPCActionMenu does
      // NOT listen for that event to open itself (only the menu's own Talk
      // action forwards to it) — so if the raycaster still dispatched the
      // old event, the menu would never open here.
      act(() => {
        window.dispatchEvent(new CustomEvent('concordia:open-dialogue', {
          detail: { npcId: 'npc-1', npcName: 'Test NPC', occupation: 'Village Vendor' },
        }));
      });
      expect(screen.queryByText('Talk')).toBeNull();

      // This is the exact function the raycaster hit-test in
      // ConcordiaScene.tsx calls once it resolves an NPC hit.
      act(() => {
        dispatchNpcContextMenuEvent({ npcId: 'npc-1', npcName: 'Test NPC', occupation: 'Village Vendor', screenX: 50, screenY: 60 });
      });
      expect(screen.getByText('Talk')).toBeDefined();
      expect(screen.getByText('Test NPC')).toBeDefined();
    });

    it('ConcordiaScene includes screenX + screenY in the dispatch payload (the menu really positions itself at those coordinates)', async () => {
      vi.stubGlobal('fetch', makeFetchMock());
      render(<NPCActionMenu />);

      // Coordinates chosen well inside jsdom's default 1024×768 viewport so
      // the component's own viewport-clamp (`Math.min(screenX, innerWidth -
      // 220)` / `Math.min(screenY, innerHeight - 320)`) is a no-op here and
      // the assertion below pins the payload values directly, not the clamp.
      act(() => {
        dispatchNpcContextMenuEvent({ npcId: 'npc-1', npcName: 'Test NPC', occupation: null, screenX: 111, screenY: 222 });
      });

      const header = screen.getByText('Test NPC');
      const menuEl = header.closest('[data-npc-action-menu]') as HTMLElement;
      expect(menuEl).not.toBeNull();
      // NPCActionMenu positions itself via `menu.screenX`/`menu.screenY` —
      // real consumption of the payload fields, not a re-implementation.
      expect(menuEl.style.left).toBe('111px');
      expect(menuEl.style.top).toBe('222px');
    });
  });

  it('NPCActionMenu mounted in the world lens via dynamic import', () => {
    const src = readFileSync(WORLD, 'utf8');
    expect(src).toMatch(/import\('@\/components\/world\/NPCActionMenu'\)/);
    expect(src).toMatch(/<NPCActionMenu \/>/);
  });
});
