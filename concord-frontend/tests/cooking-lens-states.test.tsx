/**
 * /lenses/cooking — four-UX-state contract for the Cooking lens.
 *
 * Pins that the lens renders genuine loading / error (with a WORKING Retry) /
 * empty (with an actionable CTA) / populated states against its real backend
 * channel: the recipe artifact list (useLensData('cooking', 'recipe') →
 * GET /api/lens/cooking), and that the compute-action panel drives the
 * 'cooking' domain via useRunArtifact.
 *
 * Load-bearing wiring assertion: the action runner must be constructed on the
 * 'cooking' domain — a regression to any other id would resolve to NO backend
 * receiver (the lensRun('cooking', …) callers all map to server/domains/cooking.js).
 *
 * a11y: loading is role=status (aria-busy), error is role=alert with a working
 * Retry that RE-FETCHES (we assert the underlying refetch fires). No fabricated
 * data — every state is driven by a mocked useLensData standing in for the real
 * backend in the exact shape it returns.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, waitFor, act } from '@testing-library/react';
import React from 'react';

// ── main list channel: useLensData (controls loading/error/empty/populated) ──
const lensDataState: {
  items: unknown[];
  isLoading: boolean;
  isError: boolean;
  error: Error | null;
} = { items: [], isLoading: false, isError: false, error: null };
const refetch = vi.fn();

// ── compute-action channel: useRunArtifact mutate ───────────────────────────
const runMutate = vi.fn(() => Promise.resolve({ ok: true, result: {} }));
const useRunArtifactSpy = vi.fn();

vi.mock('@/lib/hooks/use-lens-data', () => ({
  useLensData: () => ({
    items: lensDataState.items,
    total: lensDataState.items.length,
    isLoading: lensDataState.isLoading,
    isError: lensDataState.isError,
    error: lensDataState.error,
    isSeeding: false,
    refetch,
    create: vi.fn(() => Promise.resolve({})),
    update: vi.fn(() => Promise.resolve({})),
    remove: vi.fn(() => Promise.resolve({})),
    createMut: { isPending: false },
    updateMut: { isPending: false },
    deleteMut: { isPending: false },
  }),
}));

vi.mock('@/lib/hooks/use-lens-artifacts', () => ({
  useRunArtifact: (domain: string) => {
    useRunArtifactSpy(domain);
    return { mutateAsync: (...a: unknown[]) => runMutate(...a), isPending: false };
  },
}));

// ── headless chrome + heavy side panels: render-only / inert stubs ──────────
vi.mock('@/components/lens/LensShell', () => ({
  LensShell: ({ children }: { children: React.ReactNode }) =>
    React.createElement('div', { 'data-testid': 'lens-shell' }, children),
}));
vi.mock('@/hooks/useLensNav', () => ({ useLensNav: () => {} }));
vi.mock('@/hooks/useLensCommand', () => ({ useLensCommand: () => {} }));
vi.mock('@/hooks/useRealtimeLens', () => ({
  useRealtimeLens: () => ({ latestData: null, alerts: [], insights: [], isLive: false, lastUpdated: null }),
}));
vi.mock('@/components/lens/RecentMineCard', () => ({ RecentMineCard: () => null }));
vi.mock('@/components/lens/LensFeedButton', () => ({ LensFeedButton: () => null }));
vi.mock('@/components/lens/AutoActionStrip', () => ({ AutoActionStrip: () => null }));
vi.mock('@/components/lens/CrossLensRecentsPanel', () => ({ CrossLensRecentsPanel: () => null }));
vi.mock('@/components/lens/FirstRunTour', () => ({ FirstRunTour: () => null }));
vi.mock('@/components/lens/DepthBadge', () => ({ DepthBadge: () => null }));
vi.mock('@/components/lens/ManifestActionBar', () => ({ ManifestActionBar: () => null }));
vi.mock('@/components/lens/UniversalActions', () => ({ UniversalActions: () => null }));
vi.mock('@/components/lens/LiveIndicator', () => ({ LiveIndicator: () => null }));
vi.mock('@/components/lens/DTUExportButton', () => ({ DTUExportButton: () => null }));
vi.mock('@/components/lens/RealtimeDataPanel', () => ({ RealtimeDataPanel: () => null }));
vi.mock('@/components/lens/LensFeaturePanel', () => ({ LensFeaturePanel: () => null }));
vi.mock('@/components/panel-polish', () => ({
  PipingProvider: ({ children }: { children: React.ReactNode }) =>
    React.createElement(React.Fragment, null, children),
}));
// cooking child components mount their own lensRun fetches — inert here so the
// page's own list-channel states are what we assert.
vi.mock('@/components/cooking/RecipeBoxSection', () => ({ RecipeBoxSection: () => null }));
vi.mock('@/components/cooking/RecipeKitchen', () => ({ RecipeKitchen: () => null }));
vi.mock('@/components/cooking/NutritionExplorer', () => ({ NutritionExplorer: () => null }));
vi.mock('@/components/cooking/UsdaFoodSearch', () => ({ UsdaFoodSearch: () => null }));
vi.mock('@/components/cooking/CookingActionPanel', () => ({ CookingActionPanel: () => null }));
// framer-motion: render plain elements so animated nodes mount synchronously.
vi.mock('framer-motion', () => ({
  motion: new Proxy({}, { get: () => (props: Record<string, unknown>) => React.createElement('div', props, props.children as React.ReactNode) }),
  AnimatePresence: ({ children }: { children: React.ReactNode }) => React.createElement(React.Fragment, null, children),
}));

import CookingLens from '@/app/lenses/cooking/page';

const RECIPE = {
  id: 'art_1',
  title: 'Lemon Pancakes',
  data: {
    name: 'Lemon Pancakes', cuisine: 'American', difficulty: 'easy',
    prepTime: 10, cookTime: 15, servings: 4,
    ingredients: ['flour', 'milk', 'egg'], instructions: ['mix', 'cook'],
    tags: ['breakfast'], rating: 5, notes: '',
  },
  meta: { tags: [], status: 'active', visibility: 'private' },
  createdAt: '2026-06-27', updatedAt: '2026-06-27', version: 1,
};

beforeEach(() => {
  lensDataState.items = [];
  lensDataState.isLoading = false;
  lensDataState.isError = false;
  lensDataState.error = null;
  refetch.mockReset();
  runMutate.mockReset();
  runMutate.mockImplementation(() => Promise.resolve({ ok: true, result: {} }));
  useRunArtifactSpy.mockReset();
});

describe('cooking lens — wiring', () => {
  it('drives the compute-action runner on the cooking domain', () => {
    render(<CookingLens />);
    expect(useRunArtifactSpy).toHaveBeenCalledWith('cooking');
  });
});

describe('cooking lens — four UX states', () => {
  it('LOADING: shows a role=status indicator while the recipe list is in flight', () => {
    lensDataState.isLoading = true;
    const { container, getByText } = render(<CookingLens />);
    const status = container.querySelector('[role="status"]');
    expect(status).toBeTruthy();
    expect(status?.getAttribute('aria-busy')).toBe('true');
    expect(getByText(/Loading recipes/i)).toBeInTheDocument();
  });

  it('ERROR: a failed load shows role=alert + a working Retry that re-fetches', async () => {
    lensDataState.isError = true;
    lensDataState.error = new Error('recipe box offline');
    const { container, getByText } = render(<CookingLens />);
    const alert = container.querySelector('[role="alert"]');
    expect(alert).toBeTruthy();
    expect(getByText(/recipe box offline/i)).toBeInTheDocument();

    // Retry must re-invoke the backend fetch (refetch), not be a dead button.
    await act(async () => { fireEvent.click(getByText('Try again')); });
    await waitFor(() => expect(refetch).toHaveBeenCalled());
  });

  it('EMPTY: shows an honest empty state with an actionable CTA', () => {
    lensDataState.items = [];
    const { getByText } = render(<CookingLens />);
    expect(getByText(/No recipes yet/i)).toBeInTheDocument();
    // The empty state must offer a real action, not be a dead-end message.
    expect(getByText(/Create your first recipe/i)).toBeInTheDocument();
  });

  it('POPULATED: renders the real recipe row from the backend list', () => {
    lensDataState.items = [RECIPE];
    const { getAllByText } = render(<CookingLens />);
    expect(getAllByText(/Lemon Pancakes/i).length).toBeGreaterThan(0);
  });
});
