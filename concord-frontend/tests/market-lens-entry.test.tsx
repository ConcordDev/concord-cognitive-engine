import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';

const { nothing } = vi.hoisted(() => ({ nothing: () => null }));
vi.mock('@/lib/api/client', () => ({ api: { get: vi.fn(async () => ({ data: { ok: true, listings: [] } })) } }));
vi.mock('next/link', () => ({ default: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a> }));
vi.mock('@/hooks/useLensNav', () => ({ useLensNav: () => {} }));
vi.mock('@/hooks/useLensCommand', () => ({ useLensCommand: () => {} }));
vi.mock('@/hooks/useRealtimeLens', () => ({ useRealtimeLens: () => ({ latestData: null, insights: [], alerts: [], isLive: false, lastUpdated: null }) }));
vi.mock('@/components/market/MarketHeatmap', () => ({ default: nothing }));
vi.mock('@/components/market/Watchlist', () => ({ default: nothing }));
vi.mock('@/components/lens/LensShell', () => ({ LensShell: ({ children }: { children: React.ReactNode }) => <div data-testid="member-market-shell">{children}</div> }));
vi.mock('@/components/lens/DepthBadge', () => ({ DepthBadge: nothing }));
vi.mock('@/components/lens/NorthStarFrame', () => ({ NorthStarFrame: nothing }));
vi.mock('@/components/market/SectorHeatmap', () => ({ SectorHeatmapPanel: nothing }));
vi.mock('@/components/market/CompetitorTracker', () => ({ CompetitorTracker: nothing }));
vi.mock('@/components/market/CompetitiveIntelligence', () => ({ CompetitiveIntelligence: nothing }));
vi.mock('@/components/market/MarketAnalysisWorkbench', () => ({ MarketAnalysisWorkbench: nothing }));
vi.mock('@/components/market/MarketListingsPanel', () => ({ MarketListingsPanel: nothing }));
vi.mock('@/components/lens/LiveIndicator', () => ({ LiveIndicator: nothing }));
vi.mock('@/components/lens/DTUExportButton', () => ({ DTUExportButton: nothing }));
vi.mock('@/components/lens/RealtimeDataPanel', () => ({ RealtimeDataPanel: nothing }));
vi.mock('@/components/lens/SectorHeatmap', () => ({ default: nothing }));

import MarketLensEntry from '@/app/lenses/market/page';
import { AnonBrowseProvider } from '@/lib/anon-browse';

afterEach(cleanup);

describe('/lenses/market entry', () => {
  it('a signed-out visitor gets the read-only public listings, not the member lens', async () => {
    render(<AnonBrowseProvider value><MarketLensEntry /></AnonBrowseProvider>);
    expect(await screen.findByTestId('visitor-market-browse')).toBeTruthy();
    expect(screen.queryByTestId('member-market-shell')).toBeNull();
  });
  it('a member gets the full Market lens', () => {
    render(<AnonBrowseProvider value={false}><MarketLensEntry /></AnonBrowseProvider>);
    expect(screen.getByTestId('member-market-shell')).toBeTruthy();
    expect(screen.queryByTestId('visitor-market-browse')).toBeNull();
  });
});
