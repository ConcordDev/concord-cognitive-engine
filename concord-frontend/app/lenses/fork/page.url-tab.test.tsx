// @vitest-environment jsdom
/**
 * FIX-fork-003 — the Fork lens reset to the Lineage tab on every
 * reload (no tab persistence / URL state). The active view now lives
 * in the URL (?tab=lab): read at first render, written back on every
 * change via history.replaceState, so a reload, a shared link, or a
 * back/forward hop lands on the same view.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react';
import React from 'react';

vi.mock('@/hooks/useLensNav', () => ({ useLensNav: () => {} }));
vi.mock('@/hooks/useLensCommand', () => ({ useLensCommand: () => {} }));
vi.mock('@/hooks/useRealtimeLens', () => ({
  useRealtimeLens: () => ({ latestData: null, alerts: [], insights: [], isLive: false, lastUpdated: null }),
}));
vi.mock('@/lib/hooks/use-lens-data', () => ({
  useLensData: () => ({
    items: [],
    isLoading: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
  }),
}));

vi.mock('@/components/lens/LensShell', () => ({
  LensShell: ({ children }: { children: React.ReactNode }) => React.createElement('div', null, children),
}));
vi.mock('@/components/lens/NorthStarFrame', () => ({
  NorthStarFrame: (props: {
    tabs: { id: string; label: string }[];
    activeTab: string;
    onTab: (id: string) => void;
    children: React.ReactNode;
  }) =>
    React.createElement(
      'div',
      null,
      props.tabs.map((t) =>
        React.createElement(
          'button',
          {
            key: t.id,
            onClick: () => props.onTab(t.id),
            'data-active': props.activeTab === t.id ? 'true' : 'false',
          },
          t.label,
        ),
      ),
      props.children,
    ),
}));
vi.mock('@/components/lens/DepthBadge', () => ({ DepthBadge: () => null }));
vi.mock('@/components/lens/ConnectiveTissueBar', () => ({ ConnectiveTissueBar: () => null }));
vi.mock('@/components/lens/LiveIndicator', () => ({ LiveIndicator: () => null }));
vi.mock('@/components/lens/DTUExportButton', () => ({ DTUExportButton: () => null }));
vi.mock('@/components/lens/RealtimeDataPanel', () => ({ RealtimeDataPanel: () => null }));
vi.mock('@/components/common/EmptyState', () => ({ ErrorState: () => null, EmptyState: () => null }));

vi.mock('@/components/fork/ForkNetworkExplorer', () => ({ ForkNetworkExplorer: () => React.createElement('div', null, 'Network panel') }));
vi.mock('@/components/fork/RepoWatchlist', () => ({ RepoWatchlist: () => React.createElement('div', null, 'Watchlist panel') }));
vi.mock('@/components/fork/ForkInsights', () => ({ ForkInsights: () => React.createElement('div', null, 'Insights panel') }));
vi.mock('@/components/fork/ForkAnalysisLab', () => ({ ForkAnalysisLab: () => React.createElement('div', null, 'Lab panel') }));

vi.mock('framer-motion', () => ({
  motion: {
    div: ({ children, ...props }: React.HTMLAttributes<HTMLDivElement>) =>
      React.createElement('div', props, children),
  },
}));

import ForkLensPage from './page';

function setUrl(path: string) {
  window.history.replaceState(null, '', path);
}

describe('Fork lens — tab state in the URL (FIX-fork-003)', () => {
  beforeEach(() => {
    setUrl('/lenses/fork');
  });
  afterEach(() => {
    cleanup();
    setUrl('/');
  });

  it('opens on the view named by ?tab= instead of always resetting to Lineage', () => {
    setUrl('/lenses/fork?tab=insights');
    render(React.createElement(ForkLensPage));
    expect(screen.getByText('Insights panel')).toBeTruthy();
    expect(screen.queryByText('Lab panel')).toBeNull();
    expect(screen.queryByPlaceholderText(/Search forks/)).toBeNull();
  });

  it('writes the tab to the URL on switch, and a fresh mount (reload) lands back on it', async () => {
    const first = render(React.createElement(ForkLensPage));
    expect(screen.getByPlaceholderText(/Search forks/)).toBeTruthy();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Lab' }));
    });
    expect(screen.getByText('Lab panel')).toBeTruthy();
    expect(new URLSearchParams(window.location.search).get('tab')).toBe('lab');

    // Reload: a brand-new mount against the URL the switch wrote.
    first.unmount();
    render(React.createElement(ForkLensPage));
    expect(screen.getByText('Lab panel')).toBeTruthy();
    expect(screen.queryByPlaceholderText(/Search forks/)).toBeNull();
  });

  it('an unknown ?tab= value falls back to Lineage', () => {
    setUrl('/lenses/fork?tab=nonsense');
    render(React.createElement(ForkLensPage));
    expect(screen.getByPlaceholderText(/Search forks/)).toBeTruthy();
  });
});
