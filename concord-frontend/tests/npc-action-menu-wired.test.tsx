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

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MENU = path.resolve(__dirname, '..', 'components', 'world', 'NPCActionMenu.tsx');
const SCENE = path.resolve(__dirname, '..', 'components', 'world-lens', 'ConcordiaScene.tsx');
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

  // The two tests below stay as source assertions. Investigated: the dispatch
  // lives inside `handleCanvasClick` in ConcordiaScene.tsx, gated behind a real
  // THREE.Raycaster hit-test against `avatarsGroup.children` (actual mesh
  // geometry built by AvatarSystem3D, with real camera/scene refs populated in
  // a large `useEffect`). There is no pure-JS seam here — the payload object
  // literal is inline at the call site and only ever constructed after a real
  // raycaster intersection succeeds, so it can't be exercised without a real
  // WebGL context. jsdom has no WebGL/raycaster support, and (matching the
  // precedent already established for avatar-scar-render.test.tsx and
  // avatar-system-worker-wired.test.tsx) there's no mocking of
  // react-three-fiber/three internals anywhere else in this suite. Forcing a
  // mock here would test the mock, not the real hit-testing path, so this is
  // left as a documented, narrowly-scoped source assertion rather than a
  // fragile fake render.
  it('ConcordiaScene raycaster dispatches concordia:npc-context-menu (not the old open-dialogue path)', () => {
    const src = readFileSync(SCENE, 'utf8');
    expect(src).toMatch(/concordia:npc-context-menu/);
  });

  it('ConcordiaScene includes screenX + screenY in the dispatch payload', () => {
    const src = readFileSync(SCENE, 'utf8');
    // Find the context-menu dispatch block and confirm coords are there.
    const block = src.match(/concordia:npc-context-menu[\s\S]{0,400}/);
    expect(block).not.toBeNull();
    expect(block![0]).toMatch(/screenX/);
    expect(block![0]).toMatch(/screenY/);
  });

  it('NPCActionMenu mounted in the world lens via dynamic import', () => {
    const src = readFileSync(WORLD, 'utf8');
    expect(src).toMatch(/import\('@\/components\/world\/NPCActionMenu'\)/);
    expect(src).toMatch(/<NPCActionMenu \/>/);
  });
});
