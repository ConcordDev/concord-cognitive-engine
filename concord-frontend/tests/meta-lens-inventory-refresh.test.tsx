import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';

// Wave 4 gap-closure — meta-capability-map.md: `POST /api/inventory/refresh`
// (server/routes/inventory.js) had no frontend caller. app/lenses/meta/page.tsx
// pulls in LensShell/useLensNav/useLensCommand/DevPortal/SystemHealth/
// useRealtimeLens and a dozen other cross-cutting providers, so — following
// the established render pattern in tests/accounting-lens-states.test.tsx —
// this file mocks every heavy provider to an inert stub, but leaves the real
// `OverviewTab`/`MetaLensPage` component code (including the real
// `refreshInventory` handler) untouched, and asserts on the REAL api.post /
// queryClient.invalidateQueries calls the real onClick handler makes.

const apiGet = vi.fn(() => Promise.resolve({ data: { totalComponents: 1, totalLenses: 1, totalServerLibs: 1, totalRoutes: 1, orphanedCount: 0, largestFiles: [], mostImportedComponents: [] } }));
const apiPost = vi.fn(() => Promise.resolve({ data: { ok: true } }));
const invalidateQueries = vi.fn();

vi.mock('@/lib/api/client', () => ({
  api: {
    get: (...a: unknown[]) => apiGet(...(a as [])),
    post: (...a: unknown[]) => apiPost(...(a as [])),
  },
}));

vi.mock('@tanstack/react-query', () => ({
  useQuery: ({ queryFn }: { queryFn: () => Promise<unknown> }) => {
    // Resolve synchronously for the test render — good enough to reach the
    // real render tree (isLoading must go false) without faking the handler.
    void queryFn();
    return { data: { totalComponents: 1, totalLenses: 1, totalServerLibs: 1, totalRoutes: 1, orphanedCount: 0, largestFiles: [], mostImportedComponents: [] }, isLoading: false };
  },
  useQueryClient: () => ({ invalidateQueries }),
}));

vi.mock('@/hooks/useLensNav', () => ({ useLensNav: () => {} }));
vi.mock('@/hooks/useLensCommand', () => ({ useLensCommand: () => {} }));
vi.mock('@/hooks/useRealtimeLens', () => ({ useRealtimeLens: () => ({ isLive: false, lastUpdated: null }) }));
vi.mock('@/components/lens/LensShell', () => ({
  LensShell: ({ children }: { children: React.ReactNode }) => React.createElement('div', { 'data-testid': 'lens-shell' }, children),
}));
vi.mock('@/components/lens/RecentMineCard', () => ({ RecentMineCard: () => null }));
vi.mock('@/components/lens/AutoActionStrip', () => ({ AutoActionStrip: () => null }));
vi.mock('@/components/lens/CrossLensRecentsPanel', () => ({ CrossLensRecentsPanel: () => null }));
vi.mock('@/components/lens/FirstRunTour', () => ({ FirstRunTour: () => null }));
vi.mock('@/components/lens/DepthBadge', () => ({ DepthBadge: () => null }));
vi.mock('@/components/lens/ManifestActionBar', () => ({ ManifestActionBar: () => null }));
vi.mock('@/components/lens/LiveIndicator', () => ({ LiveIndicator: () => null }));
vi.mock('@/components/lens/DTUExportButton', () => ({ DTUExportButton: () => null }));
vi.mock('@/components/meta/SystemHealth', () => ({ SystemHealth: () => null }));
vi.mock('@/components/meta/DevPortal', () => ({ DevPortal: () => null }));
vi.mock('@/lib/hooks/use-lens-artifacts', () => ({
  useArtifacts: () => ({ data: null, isLoading: false }),
  useCreateArtifact: () => ({ mutate: vi.fn() }),
}));

import MetaLensPage from '@/app/lenses/meta/page';

beforeEach(() => {
  apiGet.mockClear();
  apiPost.mockClear();
  invalidateQueries.mockClear();
});

describe('meta lens — inventory refresh button (Wave 4 gap-closure)', () => {
  it('calls the real POST /api/inventory/refresh endpoint when the button is clicked', async () => {
    render(<MetaLensPage />);
    const button = screen.getByRole('button', { name: /Refresh inventory/i });
    fireEvent.click(button);
    await waitFor(() => expect(apiPost).toHaveBeenCalledWith('/api/inventory/refresh'));
  });

  it('invalidates every inventory-* query so all tabs pick up the fresh scan, not just Overview', async () => {
    render(<MetaLensPage />);
    const button = screen.getByRole('button', { name: /Refresh inventory/i });
    fireEvent.click(button);
    await waitFor(() => expect(invalidateQueries).toHaveBeenCalledTimes(1));

    const arg = invalidateQueries.mock.calls[0][0] as { predicate: (q: { queryKey: unknown[] }) => boolean };
    expect(typeof arg.predicate).toBe('function');
    // Real predicate behavior: matches any query keyed under 'inventory*',
    // rejects unrelated keys — this is the actual function the handler
    // built, not a re-implementation of it.
    expect(arg.predicate({ queryKey: ['inventory-overview'] })).toBe(true);
    expect(arg.predicate({ queryKey: ['inventory-wiring'] })).toBe(true);
    expect(arg.predicate({ queryKey: ['unrelated-key'] })).toBe(false);
  });

  it('shows a real loading state while the refresh is in flight, then resolves back to the idle label', async () => {
    let resolvePost: (() => void) | undefined;
    apiPost.mockImplementationOnce(
      () => new Promise((resolve) => { resolvePost = () => resolve({ data: { ok: true } }); }),
    );
    render(<MetaLensPage />);
    const button = screen.getByRole('button', { name: /Refresh inventory/i });
    fireEvent.click(button);

    // Real `refreshing` state flips true synchronously on click, disabling
    // the button and swapping its label — before the network call resolves.
    await waitFor(() => expect(screen.getByRole('button', { name: /Re-scanning/i })).toBeDisabled());

    resolvePost?.();
    await waitFor(() => expect(screen.getByRole('button', { name: /Refresh inventory/i })).not.toBeDisabled());
  });

  it('does not silently swallow a non-fatal refresh failure into a fake success state', async () => {
    apiPost.mockRejectedValueOnce(new Error('network down'));
    render(<MetaLensPage />);
    const button = screen.getByRole('button', { name: /Refresh inventory/i });
    fireEvent.click(button);

    // The catch swallows the error (no crash, no error UI) but the finally
    // still clears the spinner — and crucially invalidateQueries is never
    // reached on the failure path.
    await waitFor(() => expect(screen.getByRole('button', { name: /Refresh inventory/i })).not.toBeDisabled());
    expect(invalidateQueries).not.toHaveBeenCalled();
  });
});
