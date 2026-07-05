/**
 * Fix 5 (verification audit, 2026-07-05) — the crafting lens's header-refresh
 * world-change listener.
 *
 * The page used to listen for `concordia:world-changed`, a name nothing in
 * the codebase dispatches. The real, canonical event
 * (`hooks/useWorldTravel.ts` dispatches it; `hooks/useActiveWorldId.ts`
 * exports it as `ACTIVE_WORLD_CHANGED_EVENT`) is
 * `concordia:active-world-changed`. Fixed to import + listen on the
 * constant, matching the pattern CrossWorldPotencyHUD.tsx already uses for
 * the same event name.
 *
 * Mocking follows the same pattern as tests/crafting-lens-states.test.tsx
 * (the page's real api/lensRun channels are mocked; heavy children are
 * render-only stubs) so this test stays focused on the header-refresh wiring.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, waitFor, act } from '@testing-library/react';
import React from 'react';

const apiGet = vi.fn();
const apiPost = vi.fn();
const lensRun = vi.fn();
vi.mock('@/lib/api/client', () => ({
  api: { get: (...a: unknown[]) => apiGet(...a), post: (...a: unknown[]) => apiPost(...a) },
  lensRun: (...args: unknown[]) => lensRun(...args),
}));

vi.mock('@/lib/hooks/use-lens-artifacts', () => ({
  useArtifacts: () => ({ data: { artifacts: [] }, isLoading: false, isError: false }),
  useCreateArtifact: () => ({ mutate: vi.fn() }),
}));

vi.mock('@/components/lens/LensShell', () => ({
  LensShell: ({ children }: { children: React.ReactNode }) =>
    React.createElement('div', { 'data-testid': 'lens-shell' }, children),
}));
vi.mock('@/hooks/useLensCommand', () => ({ useLensCommand: () => {} }));
vi.mock('@/components/lens/RecentMineCard', () => ({ RecentMineCard: () => null }));
vi.mock('@/components/lens/AutoActionStrip', () => ({ AutoActionStrip: () => null }));
vi.mock('@/components/lens/CrossLensRecentsPanel', () => ({ CrossLensRecentsPanel: () => null }));
vi.mock('@/components/lens/FirstRunTour', () => ({ FirstRunTour: () => null }));
vi.mock('@/components/lens/DepthBadge', () => ({ DepthBadge: () => null }));
vi.mock('@/components/lens/ManifestActionBar', () => ({ ManifestActionBar: () => null }));
vi.mock('@/components/crafting/RecipeLedger', () => ({ RecipeLedger: () => null }));
vi.mock('@/components/crafting/CraftingWorkbench', () => ({ CraftingWorkbench: () => null }));
vi.mock('next/dynamic', () => ({ default: () => () => null }));

vi.mock('lucide-react', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  const make = (name: string) => {
    const Icon = React.forwardRef<SVGSVGElement, Record<string, unknown>>((props, ref) =>
      React.createElement('span', { 'data-testid': `icon-${name}`, ref, ...props }));
    Icon.displayName = name;
    return Icon;
  };
  return new Proxy(actual, {
    get: (target, prop: string) => (prop in target ? make(prop) : (target as Record<string, unknown>)[prop]),
  });
});

import CraftingPage from '@/app/lenses/crafting/page';
import { ACTIVE_WORLD_CHANGED_EVENT } from '@/hooks/useActiveWorldId';

function ok(data: Record<string, unknown>) {
  return Promise.resolve({ data });
}

function baseApiGet(url: string) {
  if (url === '/api/personal-locker/dtus') return ok({ dtus: [] });
  if (typeof url === 'string' && url.startsWith('/api/crafting/character/')) return ok({ level: 1 });
  if (typeof url === 'string' && url.startsWith('/api/crafting/resource-bars/')) return ok({ bars: [] });
  if (url === '/api/economy/balance') return ok({ balance: 0 });
  return ok({});
}

function characterCallCount() {
  return apiGet.mock.calls.filter((c) => typeof c[0] === 'string' && c[0].startsWith('/api/crafting/character/')).length;
}

beforeEach(() => {
  apiGet.mockReset();
  apiPost.mockReset();
  lensRun.mockReset();
  lensRun.mockImplementation((_d: string, name: string) =>
    Promise.resolve({ data: { ok: true, result: name === 'favorite_list' ? { favorites: [], count: 0 } : {} } }));
  apiGet.mockImplementation(baseApiGet);
  window.localStorage.clear();
});

describe('crafting lens — world-change header refresh', () => {
  it('re-runs the header refresh on the canonical concordia:active-world-changed event', async () => {
    render(<CraftingPage />);
    await waitFor(() => expect(characterCallCount()).toBe(1));

    act(() => {
      window.dispatchEvent(new CustomEvent(ACTIVE_WORLD_CHANGED_EVENT, { detail: { worldId: 'tunya' } }));
    });

    await waitFor(() => expect(characterCallCount()).toBe(2));
  });

  it('does NOT react to the old, non-existent "concordia:world-changed" name', async () => {
    render(<CraftingPage />);
    await waitFor(() => expect(characterCallCount()).toBe(1));

    act(() => {
      window.dispatchEvent(new CustomEvent('concordia:world-changed', { detail: { worldId: 'tunya' } }));
    });

    // Give any (incorrect) listener a chance to fire, then confirm no extra call.
    await new Promise((r) => setTimeout(r, 20));
    expect(characterCallCount()).toBe(1);
  });
});
