import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

vi.mock('@/lib/api/client', () => ({
  api: { get: vi.fn(async () => ({ data: {} })) },
  apiHelpers: { guidance: { health: vi.fn(async () => ({ data: {} })) } },
  lensRun: vi.fn(async () => ({ data: { ok: true, result: {} } })),
}));
vi.mock('@/components/lens/LensShell', () => ({ LensShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }));
vi.mock('@/components/lens/NorthStarFrame', () => ({
  NorthStarFrame: ({ tabs, activeTab, onTab, children }: {
    tabs: { id: string; label: string }[];
    activeTab: string;
    onTab: (id: string) => void;
    children: React.ReactNode;
  }) => (
    <div>
      <div data-testid="active-view">{activeTab}</div>
      {tabs.map((t) => (
        <button key={t.id} type="button" onClick={() => onTab(t.id)}>{t.label}</button>
      ))}
      {children}
    </div>
  ),
}));
vi.mock('@/components/lens/DepthBadge', () => ({ DepthBadge: () => null }));
vi.mock('@/components/lens/LiveIndicator', () => ({ LiveIndicator: () => null }));
vi.mock('@/components/lens/DTUExportButton', () => ({ DTUExportButton: () => null }));
vi.mock('@/components/lens/RealtimeDataPanel', () => ({ RealtimeDataPanel: () => null }));
vi.mock('@/components/platform/PipelineMonitor', () => ({ default: () => null }));
vi.mock('@/components/platform/NerveCenter', () => ({ default: () => null }));
vi.mock('@/components/platform/EmpiricalGatesPanel', () => ({ default: () => null }));
vi.mock('@/components/platform/ScopeControls', () => ({ default: () => null }));
vi.mock('@/components/platform/PlatformConsole', () => ({ default: () => null }));
vi.mock('@/components/platform/PlatformAnalysisPanel', () => ({ PlatformAnalysisPanel: () => null }));
vi.mock('@/components/platform/PlatformRepos', () => ({ PlatformRepos: () => null }));
vi.mock('@/components/platform/usePlatformEvents', () => ({ usePlatformEvents: () => ({ events: [], connected: false }) }));
vi.mock('@/hooks/useLensNav', () => ({ useLensNav: () => {} }));
vi.mock('@/hooks/useLensCommand', () => ({ useLensCommand: () => {} }));
vi.mock('@/hooks/useRealtimeLens', () => ({
  useRealtimeLens: () => ({ latestData: null, alerts: [], insights: [], isLive: false, lastUpdated: null }),
}));

import PlatformPage from '@/app/lenses/platform/page';
import { getLensState } from '@/lib/lens-state-persistence';

function renderPage() {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <PlatformPage />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  window.localStorage.clear();
});

// FIX-platform-005 (view half) — the selected Platform view reset to
// Overview on every reload. It now persists through the shared lens
// UI-state store and is restored on mount.
describe('FIX-platform-005 — selected view survives a reload', () => {
  it('switching views persists the choice, and a remount restores it instead of Overview', async () => {
    const first = renderPage();
    await waitFor(() => expect(screen.getByTestId('active-view').textContent).toBe('overview'));

    fireEvent.click(screen.getByRole('button', { name: 'Console' }));
    await waitFor(() => expect(screen.getByTestId('active-view').textContent).toBe('console'));
    expect(getLensState('platform')?.activeTab).toBe('console');

    first.unmount();
    renderPage();
    await waitFor(() => expect(screen.getByTestId('active-view').textContent).toBe('console'));
  });

  it('an unknown persisted view falls back to Overview', async () => {
    window.localStorage.setItem('concord-lens-ui-state', JSON.stringify({
      platform: { state: { activeTab: 'not-a-view' }, savedAt: Date.now() },
    }));
    renderPage();
    await waitFor(() => expect(screen.getByTestId('active-view').textContent).toBe('overview'));
  });
});
