/**
 * /lenses/sub-worlds — four-UX-state contract.
 *
 * Pins that the Sub-Worlds lens renders genuine loading / error (with a working
 * Retry) / empty / populated states against the real macro surface
 * (lensRun('sub_worlds', …) → POST /api/lens/run), plus a11y (the kind/sort
 * selects + capacity input carry accessible names; loading is role=status;
 * error is role=alert). The lens-id is `sub-worlds`; the macro DOMAIN is
 * `sub_worlds` (underscore) — distinct and correct.
 *
 * No fabricated data: every state is driven by a mocked lensRun standing in for
 * the real backend, exactly the shape server/domains/sub-worlds.js returns. The
 * headless LensShell + the lens-helper widgets (which make their own backend
 * calls) are stubbed so the test stays on the page's own state machine.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, waitFor, act } from '@testing-library/react';
import React from 'react';

// ── lensRun mock — the page's single backend channel ────────────────────────
const lensRun = vi.fn();
vi.mock('@/lib/api/client', () => ({
  lensRun: (...args: unknown[]) => lensRun(...args),
}));

// ── headless shell + lens-helper widgets: render-only stubs ─────────────────
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
vi.mock('@/components/sub-worlds/MetaverseRepos', () => ({ MetaverseRepos: () => null }));
vi.mock('@/components/sub-worlds/WorldSettingsPanel', () => ({ WorldSettingsPanel: () => null }));
vi.mock('@/components/sub-worlds/WorldEditorPanel', () => ({ WorldEditorPanel: () => null }));
vi.mock('@/components/sub-worlds/WorldAnalyticsPanel', () => ({ WorldAnalyticsPanel: () => null }));
vi.mock('@/components/sub-worlds/WorldCard', () => ({
  // Render the world name so POPULATED can assert real macro data is on screen.
  WorldCard: ({ world }: { world: { world_id: string; name: string } }) =>
    React.createElement('div', { 'data-testid': `world-card-${world.world_id}` }, world.name),
}));
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
import SubWorldsPage from '@/app/lenses/sub-worlds/page';

// lensRun returns an axios-shaped { data: { ok, result, error } }.
function reply(result: Record<string, unknown>, ok = true, error: string | null = null) {
  return Promise.resolve({ data: { ok, result, error } });
}

const PUBLIC_WORLD = {
  world_id: 'subw_1', name: 'Gravity Lab', description: 'physics', kind: 'physics_simulator',
  privacy: 'public', status: 'active', capacity: 16, visits: 4, unique_visitors: 2,
  favorites: 1, popularity: 17, is_owner: false, can_edit: false,
};

beforeEach(() => { lensRun.mockReset(); });

describe('sub-worlds lens — four UX states', () => {
  it('LOADING: shows a role=status indicator while discover is in flight', async () => {
    // discover never resolves → page stays in the loading state. my_favorites
    // (the mount-time loadFavorites call) resolves so it doesn't hang the rest.
    lensRun.mockImplementation((_d: string, name: string) => {
      if (name === 'discover') return new Promise(() => {});
      return reply({ worlds: [] });
    });
    const { getByTestId } = render(<SubWorldsPage />);
    await waitFor(() => expect(getByTestId('sub-worlds-loading')).toBeInTheDocument());
    expect(getByTestId('sub-worlds-loading')).toHaveAttribute('role', 'status');
    expect(getByTestId('sub-worlds-loading')).toHaveAttribute('aria-busy', 'true');
  });

  it('ERROR: a failed discover shows role=alert + a working Retry that re-fetches', async () => {
    let fail = true;
    lensRun.mockImplementation((_d: string, name: string) => {
      if (name === 'discover') {
        if (fail) return Promise.reject(new Error('network down'));
        return reply({ worlds: [PUBLIC_WORLD], total: 1 });
      }
      return reply({ worlds: [] });
    });
    const { getByTestId, getByText } = render(<SubWorldsPage />);
    await waitFor(() => expect(getByTestId('sub-worlds-error')).toBeInTheDocument());
    expect(getByTestId('sub-worlds-error')).toHaveAttribute('role', 'alert');
    expect(getByText(/network down/i)).toBeInTheDocument();

    const before = lensRun.mock.calls.filter((c) => c[1] === 'discover').length;
    fail = false;
    await act(async () => { fireEvent.click(getByText('Retry')); });
    await waitFor(() =>
      expect(lensRun.mock.calls.filter((c) => c[1] === 'discover').length).toBeGreaterThan(before));
    // recovers to populated
    await waitFor(() => expect(getByTestId('sub-worlds-list')).toBeInTheDocument());
  });

  it('ERROR (ok:false): an envelope error surfaces in the alert', async () => {
    lensRun.mockImplementation((_d: string, name: string) =>
      name === 'discover'
        ? reply(null as unknown as Record<string, unknown>, false, 'bad_numeric_field')
        : reply({ worlds: [] }));
    const { getByTestId, getByText } = render(<SubWorldsPage />);
    await waitFor(() => expect(getByTestId('sub-worlds-error')).toBeInTheDocument());
    expect(getByText(/bad_numeric_field/i)).toBeInTheDocument();
  });

  it('EMPTY: shows the honest "no public sub-worlds" CTA when discover === 0', async () => {
    lensRun.mockImplementation(() => reply({ worlds: [], total: 0 }));
    const { getByTestId } = render(<SubWorldsPage />);
    await waitFor(() => expect(getByTestId('sub-worlds-empty')).toBeInTheDocument());
    expect(getByTestId('sub-worlds-empty').textContent).toMatch(/No public sub-worlds match/i);
  });

  it('POPULATED: renders a real discovered world card from macro data', async () => {
    lensRun.mockImplementation((_d: string, name: string) =>
      name === 'discover' ? reply({ worlds: [PUBLIC_WORLD], total: 1 }) : reply({ worlds: [] }));
    const { getByTestId } = render(<SubWorldsPage />);
    await waitFor(() => expect(getByTestId('sub-worlds-list')).toBeInTheDocument());
    expect(getByTestId('world-card-subw_1').textContent).toMatch(/Gravity Lab/);
  });

  it('a11y: the kind filter, sort, and capacity controls carry accessible names', async () => {
    lensRun.mockImplementation(() => reply({ worlds: [] }));
    const { getByLabelText } = render(<SubWorldsPage />);
    await waitFor(() => expect(getByLabelText('Filter by kind')).toBeInTheDocument());
    expect(getByLabelText('Sort')).toBeInTheDocument();
    expect(getByLabelText('Capacity')).toBeInTheDocument();
  });

  it('drives a real spawn round-trip then routes to the My Worlds list', async () => {
    const spawned = { ...PUBLIC_WORLD, world_id: 'subw_new', name: 'Ocean Sim', is_owner: true };
    lensRun.mockImplementation((_d: string, name: string) => {
      if (name === 'spawn') return reply({ world: spawned });
      if (name === 'list') return reply({ worlds: [spawned] });
      return reply({ worlds: [] });
    });
    const { getByPlaceholderText, getByRole, getByTestId } = render(<SubWorldsPage />);
    await waitFor(() => expect(getByTestId('lens-shell')).toBeInTheDocument());

    await act(async () => {
      fireEvent.change(getByPlaceholderText('World name'), { target: { value: 'Ocean Sim' } });
    });
    await act(async () => { fireEvent.click(getByRole('button', { name: 'Spawn Sub-World' })); });

    // spawn macro fired and the page switched to the populated "mine" list
    await waitFor(() => expect(lensRun.mock.calls.some((c) => c[1] === 'spawn')).toBe(true));
    await waitFor(() => expect(getByTestId('world-card-subw_new')).toBeInTheDocument());
  });
});
