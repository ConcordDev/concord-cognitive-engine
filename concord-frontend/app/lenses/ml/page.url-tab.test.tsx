// @vitest-environment jsdom
/**
 * FIX-ml-010 — ML tab state was not in the URL, so a reload always
 * reset to Model Hub. The active tab now lives in ?tab=: read at first
 * render, written back on every change via history.replaceState, so a
 * reload, a shared link, or a back/forward hop lands on the same tab.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react';
import React from 'react';

vi.mock('@/hooks/useLensNav', () => ({ useLensNav: () => {} }));
vi.mock('@/hooks/useLensCommand', () => ({ useLensCommand: () => {} }));
vi.mock('@/hooks/useRealtimeLens', () => ({
  useRealtimeLens: () => ({ latestData: null, insights: [], isLive: false, lastUpdated: null }),
}));
vi.mock('@/store/ui', () => ({
  useUIStore: { getState: () => ({ addToast: vi.fn() }) },
}));

vi.mock('@/components/lens/LensShell', () => ({
  LensShell: ({ children }: { children: React.ReactNode }) => React.createElement('div', null, children),
}));
vi.mock('@/components/lens/CrossLensRecentsPanel', () => ({ CrossLensRecentsPanel: () => null }));
vi.mock('@/components/lens/DepthBadge', () => ({ DepthBadge: () => null }));
vi.mock('@/components/lens/LiveIndicator', () => ({ LiveIndicator: () => null }));
vi.mock('@/components/lens/DTUExportButton', () => ({ DTUExportButton: () => null }));
vi.mock('@/components/lens/RealtimeDataPanel', () => ({ RealtimeDataPanel: () => null }));
vi.mock('@/components/panel-polish', () => ({
  PipingProvider: ({ children }: { children: React.ReactNode }) => React.createElement('div', null, children),
}));

vi.mock('@/components/ml/ModelHubPanel', () => ({ ModelHubPanel: () => React.createElement('div', null, 'Model Hub panel') }));
vi.mock('@/components/ml/InferencePlayground', () => ({ InferencePlayground: () => React.createElement('div', null, 'Playground panel') }));
vi.mock('@/components/ml/ExperimentTracker', () => ({ ExperimentTracker: () => React.createElement('div', null, 'Experiments panel') }));
vi.mock('@/components/ml/DatasetHubPanel', () => ({ DatasetHubPanel: () => React.createElement('div', null, 'Datasets panel') }));
vi.mock('@/components/ml/ModelComparePanel', () => ({ ModelComparePanel: () => React.createElement('div', null, 'Compare panel') }));
vi.mock('@/components/ml/AutoMLPanel', () => ({ AutoMLPanel: () => React.createElement('div', null, 'AutoML panel') }));
vi.mock('@/components/ml/DeploymentsPanel', () => ({ DeploymentsPanel: () => React.createElement('div', null, 'Deployments panel') }));
vi.mock('@/components/ml/SpacesPanel', () => ({ SpacesPanel: () => React.createElement('div', null, 'Spaces panel') }));
vi.mock('@/components/ml/MlActionPanel', () => ({ MlActionPanel: () => React.createElement('div', null, 'Bench panel') }));
vi.mock('@/components/ml/MlRepos', () => ({ MlRepos: () => React.createElement('div', null, 'Repos panel') }));
vi.mock('@/components/research/ArxivPanel', () => ({ ArxivPanel: () => React.createElement('div', null, 'arXiv panel') }));

import MLLensPage from './page';

function setUrl(path: string) {
  window.history.replaceState(null, '', path);
}

describe('ML lens — tab state in the URL (FIX-ml-010)', () => {
  beforeEach(() => {
    setUrl('/lenses/ml');
  });
  afterEach(() => {
    cleanup();
    setUrl('/');
  });

  it('opens on the tab named by ?tab= instead of always resetting to Model Hub', () => {
    setUrl('/lenses/ml?tab=datasets');
    render(React.createElement(MLLensPage));
    expect(screen.getByText('Datasets panel')).toBeTruthy();
    expect(screen.queryByText('Model Hub panel')).toBeNull();
  });

  it('writes the tab to the URL on switch, and a fresh mount (reload) lands back on it', async () => {
    const first = render(React.createElement(MLLensPage));
    expect(screen.getByText('Model Hub panel')).toBeTruthy();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Experiments/ }));
    });
    expect(screen.getByText('Experiments panel')).toBeTruthy();
    expect(new URLSearchParams(window.location.search).get('tab')).toBe('experiments');

    first.unmount();
    render(React.createElement(MLLensPage));
    expect(screen.getByText('Experiments panel')).toBeTruthy();
    expect(screen.queryByText('Model Hub panel')).toBeNull();
  });

  it('an unknown ?tab= value falls back to Model Hub', () => {
    setUrl('/lenses/ml?tab=nonsense');
    render(React.createElement(MLLensPage));
    expect(screen.getByText('Model Hub panel')).toBeTruthy();
  });
});
