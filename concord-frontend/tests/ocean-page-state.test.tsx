// ocean-page-state.test.tsx — Ocean S3 (B9, 2026-11-03): the page keeps
// a visited view mounted (hidden), so the Tides view's fetched state
// survives a view switch — conditional rendering unmounted it (F3).
// The panels are stubbed; the stateful counter stands in for fetched
// state: an unmounting page resets it.

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState } from 'react';

vi.mock('@/lib/api/client', () => ({
  lensRun: async () => ({ data: { ok: true, result: { spots: [] }, error: null } }),
}));

// ── S3 — page-level keep-mounted ─────────────────────────────────────
vi.mock('@/components/lens/LensShell', () => ({ LensShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }));
vi.mock('@/components/lens/NorthStarFrame', () => ({
  NorthStarFrame: ({ tabs, onTab, children }: { tabs: Array<{ id: string; label: string }>; onTab: (id: string) => void; children: React.ReactNode }) => (
    <div>
      {tabs.map((t) => <button key={t.id} onClick={() => onTab(t.id)}>{t.label}</button>)}
      {children}
    </div>
  ),
}));
vi.mock('@/components/lens/DepthBadge', () => ({ DepthBadge: () => null }));
vi.mock('@/components/lens/LiveIndicator', () => ({ LiveIndicator: () => null }));
vi.mock('@/components/lens/DTUExportButton', () => ({ DTUExportButton: () => null }));
vi.mock('@/components/lens/RealtimeDataPanel', () => ({ RealtimeDataPanel: () => null }));
vi.mock('@/components/lens/LensFeedButton', () => ({ LensFeedButton: () => null }));
vi.mock('@/components/feeds/LensFeedPanel', () => ({ LensFeedPanel: () => null }));
vi.mock('@/components/wiki/WikipediaSearchPanel', () => ({ WikipediaSearchPanel: () => null }));
vi.mock('@/components/ocean/TidePredictions', () => ({ TidePredictions: () => null }));
vi.mock('@/components/ocean/TideActionStack', () => ({ TideActionStack: () => null }));
vi.mock('@/components/ocean/NoaaStationExplorer', () => ({ NoaaStationExplorer: () => null }));
vi.mock('@/components/ocean/WaveEcosystemPanel', () => ({ WaveEcosystemPanel: () => null }));
vi.mock('@/components/ocean/TidalSalinityPanel', () => ({ TidalSalinityPanel: () => null }));
vi.mock('@/components/ocean/SpotLog', () => ({ SpotLog: () => null }));
vi.mock('@/components/ocean/LiveMarinePanel', () => ({ LiveMarinePanel: () => null }));
vi.mock('@/hooks/useLensNav', () => ({ useLensNav: () => {} }));
vi.mock('@/hooks/useLensCommand', () => ({ useLensCommand: () => {} }));
vi.mock('@/hooks/useRealtimeLens', () => ({ useRealtimeLens: () => ({ latestData: null, isLive: false, lastUpdated: null, insights: null }) }));
vi.mock('next/dynamic', () => ({ default: () => () => null }));
vi.mock('@/components/common/MapView', () => ({ default: () => null }));

// The stateful stand-in for the Tides view's anchor panel: if the page
// unmounts the view on a tab switch, this counter resets.
vi.mock('@/components/ocean/NoaaTidesPanel', () => ({
  NoaaTidesPanel: () => {
    const [n, setN] = useState(0);
    return <button onClick={() => setN(n + 1)}>tides-count {n}</button>;
  },
}));

import OceanLensPage from '@/app/lenses/ocean/page';

function wrap(node: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{node}</QueryClientProvider>);
}

describe('S3 — the Tides view keeps its state across view switches', () => {
  it('a visited view stays mounted (hidden) while another view is active', async () => {
    wrap(<OceanLensPage />);
    const counter = await screen.findByRole('button', { name: /tides-count 0/ });
    fireEvent.click(counter);
    expect(screen.getByRole('button', { name: /tides-count 1/ })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Logbook' }));
    fireEvent.click(screen.getByRole('button', { name: 'Tides' }));
    expect(screen.getByRole('button', { name: /tides-count 1/ })).toBeTruthy();
  });
});
