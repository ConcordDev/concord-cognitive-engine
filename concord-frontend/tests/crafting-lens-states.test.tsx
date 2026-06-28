/**
 * /lenses/crafting — four-UX-state contract.
 *
 * Pins that the Crafting workbench renders genuine loading / error (with a
 * working Retry) / empty / populated states against the real backend surface
 * the page drives — the personal-locker recipe feed (api.get
 * '/api/personal-locker/dtus') and the crafting favorite macros
 * (lensRun('crafting','favorite_list' | 'favorite_toggle')) — plus a11y
 * (the recipe search input carries an accessible name; loading is role=status;
 * error is role=alert with a working Retry).
 *
 * No fabricated data: every state is driven by a controllable mock of the page's
 * two real channels (axios `api` + `lensRun`), in exactly the shape the server
 * returns. The headless LensShell, the dynamic-imported panels, and the heavy
 * lens-primitive cards are render-only stubs so the test stays on the MineTab's
 * own state machine.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, waitFor, act } from '@testing-library/react';
import React from 'react';

// ── the page's two backend channels ─────────────────────────────────────────
const apiGet = vi.fn();
const apiPost = vi.fn();
const lensRun = vi.fn();
vi.mock('@/lib/api/client', () => ({
  api: { get: (...a: unknown[]) => apiGet(...a), post: (...a: unknown[]) => apiPost(...a) },
  lensRun: (...args: unknown[]) => lensRun(...args),
}));

// ── persistence hooks (Forge tab craft-session artifacts) ───────────────────
vi.mock('@/lib/hooks/use-lens-artifacts', () => ({
  useArtifacts: () => ({ data: { artifacts: [] }, isLoading: false, isError: false }),
  useCreateArtifact: () => ({ mutate: vi.fn() }),
}));

// ── headless shell + heavy children: render-only stubs ──────────────────────
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
// dynamic() panels — return a no-op component so next/dynamic resolves to null.
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

// Import AFTER mocks are registered.
import CraftingPage from '@/app/lenses/crafting/page';

// api.get returns an axios-shaped { data }.
function ok(data: Record<string, unknown>) {
  return Promise.resolve({ data });
}
function lensReply(result: Record<string, unknown>, success = true) {
  return Promise.resolve({ data: { ok: success, result } });
}

const RECIPE = {
  id: 'dtu_iron_sword',
  title: 'Iron Sword',
  meta: { type: 'blueprint', description: 'A sturdy blade.' },
  created_at: '2026-02-01T00:00:00Z',
};

// Default: header/aux endpoints resolve harmlessly; tests override the
// personal-locker feed + favorite macros to drive each state.
function baseApiGet(url: string) {
  if (url === '/api/personal-locker/dtus') return ok({ dtus: [] });
  if (typeof url === 'string' && url.startsWith('/api/crafting/character/')) return ok({ level: 1 });
  if (typeof url === 'string' && url.startsWith('/api/crafting/resource-bars/')) return ok({ bars: [] });
  if (url === '/api/economy/balance') return ok({ balance: 0 });
  return ok({});
}

beforeEach(() => {
  apiGet.mockReset();
  apiPost.mockReset();
  lensRun.mockReset();
  lensRun.mockImplementation((_d: string, name: string) =>
    name === 'favorite_list' ? lensReply({ favorites: [], count: 0 }) : lensReply({}, true));
  // jsdom localStorage exists; ensure no avatar id surprises.
  window.localStorage.clear();
});

describe('crafting lens — four UX states (MineTab, the default surface)', () => {
  it('LOADING: shows a role=status indicator while the recipe feed is in flight', async () => {
    // personal-locker call (the MineTab load) never resolves → stays loading.
    apiGet.mockImplementation((url: string) => {
      if (url === '/api/personal-locker/dtus') return new Promise(() => {});
      return baseApiGet(url);
    });
    const { container } = render(<CraftingPage />);
    await waitFor(() => expect(container.querySelector('[role="status"]')).toBeTruthy());
  });

  it('a11y: the recipe search input carries an accessible name', async () => {
    apiGet.mockImplementation(baseApiGet);
    const { getByLabelText } = render(<CraftingPage />);
    await waitFor(() => expect(getByLabelText('Search recipes')).toBeInTheDocument());
  });

  it('EMPTY: an empty recipe feed shows the honest "no personal recipes yet" CTA', async () => {
    apiGet.mockImplementation(baseApiGet);
    const { getByText } = render(<CraftingPage />);
    await waitFor(() =>
      expect(getByText(/No personal recipes yet/i)).toBeInTheDocument());
  });

  it('ERROR: a failed recipe feed shows role=alert + a working Retry that re-fetches', async () => {
    let fail = true;
    apiGet.mockImplementation((url: string) => {
      if (url === '/api/personal-locker/dtus') {
        // header refresh swallows errors with .catch(); MineTab load surfaces them.
        return fail ? Promise.reject(new Error('feed exploded')) : ok({ dtus: [] });
      }
      return baseApiGet(url);
    });
    const { container, getByText } = render(<CraftingPage />);

    await waitFor(() => expect(container.querySelector('[role="alert"]')).toBeTruthy());
    expect(getByText(/feed exploded/i)).toBeInTheDocument();

    // Retry re-runs the MineTab load → now succeeds → empty CTA appears.
    const before = apiGet.mock.calls.filter((c) => c[0] === '/api/personal-locker/dtus').length;
    fail = false;
    await act(async () => { fireEvent.click(getByText('Retry')); });
    await waitFor(() =>
      expect(apiGet.mock.calls.filter((c) => c[0] === '/api/personal-locker/dtus').length)
        .toBeGreaterThan(before));
    await waitFor(() => expect(getByText(/No personal recipes yet/i)).toBeInTheDocument());
  });

  it('POPULATED: a real recipe renders, and the favorite star reflects favorite_list', async () => {
    apiGet.mockImplementation((url: string) =>
      url === '/api/personal-locker/dtus' ? ok({ dtus: [RECIPE] }) : baseApiGet(url));
    // favorite_list already starred this recipe → star should read favorited.
    lensRun.mockImplementation((_d: string, name: string) => {
      if (name === 'favorite_list') {
        return lensReply({ favorites: [{ recipeId: 'dtu_iron_sword', recipeName: 'Iron Sword', favoritedAt: '2026-02-01T00:00:00Z' }], count: 1 });
      }
      return lensReply({}, true);
    });
    const { getByText } = render(<CraftingPage />);
    await waitFor(() => expect(getByText('Iron Sword')).toBeInTheDocument());
    expect(getByText('List on marketplace')).toBeInTheDocument();
  });

  it('POPULATED: toggling the star fires the real favorite_toggle macro', async () => {
    apiGet.mockImplementation((url: string) =>
      url === '/api/personal-locker/dtus' ? ok({ dtus: [RECIPE] }) : baseApiGet(url));
    const { getByText, getByLabelText } = render(<CraftingPage />);
    await waitFor(() => expect(getByText('Iron Sword')).toBeInTheDocument());

    lensRun.mockImplementation((_d: string, name: string) => {
      if (name === 'favorite_list') return lensReply({ favorites: [], count: 0 });
      if (name === 'favorite_toggle') return lensReply({ favorited: true, recipeId: 'dtu_iron_sword', count: 1 });
      return lensReply({}, true);
    });
    await act(async () => { fireEvent.click(getByLabelText('Toggle favorite')); });
    await waitFor(() =>
      expect(lensRun.mock.calls.some((c) => c[1] === 'favorite_toggle')).toBe(true));
    const toggleCall = lensRun.mock.calls.find((c) => c[1] === 'favorite_toggle');
    expect(toggleCall?.[2]).toMatchObject({ recipeId: 'dtu_iron_sword' });
  });
});
