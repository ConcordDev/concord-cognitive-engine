/**
 * FIX-integrations-009 — Integrations at 390px.
 *
 * Two halves: the "Webh…" clipped tab label rides the shared
 * NorthStarFrame strip — cured by the landed shell genus (c86910c5c:
 * the strip scrolls cleanly at 390px, native bar hidden, active pill
 * kept in view; pinned here through this page's own nav) — and the
 * "Add webhook" FAB floated over the create form it opens. The page
 * now renders the CTA only while the create form is closed.
 */
import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/components/lens/CrossLensRecentsPanel', () => ({ CrossLensRecentsPanel: () => null }));
vi.mock('@/components/lens/LensShell', () => ({
  LensShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock('@/components/lens/DepthBadge', () => ({ DepthBadge: () => null }));
vi.mock('@/components/lens/LiveIndicator', () => ({ LiveIndicator: () => null }));
vi.mock('@/components/lens/DTUExportButton', () => ({ DTUExportButton: () => null }));
vi.mock('@/components/lens/RealtimeDataPanel', () => ({ RealtimeDataPanel: () => null }));
vi.mock('@/components/integrations/IntegrationsRepos', () => ({ IntegrationsRepos: () => null }));
vi.mock('@/components/integrations/WorkflowsPanel', () => ({ WorkflowsPanel: () => <div>workflows panel</div> }));
vi.mock('@/components/integrations/ConnectorCatalog', () => ({ ConnectorCatalog: () => null }));
vi.mock('@/components/integrations/AnalysisPanel', () => ({ AnalysisPanel: () => null }));
vi.mock('@/components/integrations/WebhooksPanel', () => ({
  WebhooksPanel: ({ showCreate, setShowCreate }: { showCreate: boolean; setShowCreate: (v: boolean) => void }) => (
    <div>
      <span>webhooks panel create:{showCreate ? 'open' : 'closed'}</span>
      {showCreate && <button type="button" onClick={() => setShowCreate(false)}>Close form</button>}
    </div>
  ),
}));
vi.mock('@/hooks/useLensNav', () => ({ useLensNav: () => {} }));
vi.mock('@/hooks/useLensCommand', () => ({ useLensCommand: () => {} }));
vi.mock('@/hooks/useRealtimeLens', () => ({
  useRealtimeLens: () => ({ data: [], insights: [], alerts: [], isLive: false, lastUpdated: null }),
}));
vi.mock('@tanstack/react-query', () => ({
  useQuery: () => ({ data: undefined, isLoading: false, isError: false, error: null, refetch: vi.fn() }),
}));
vi.mock('@/lib/api/client', () => ({
  lensRun: vi.fn(async () => ({ data: { ok: true, result: {} } })),
  apiHelpers: {},
}));

import IntegrationsLensPage from '@/app/lenses/integrations/page';

describe('FIX-integrations-009 — tab strip + webhook FAB at 390px', () => {
  it('scrolls the tab strip cleanly (landed shell genus) and hides the FAB while the create form is open', () => {
    render(<IntegrationsLensPage />);
    const nav = screen.getByRole('navigation', { name: 'Integration views' });
    expect(nav.className).toContain('no-scrollbar');
    expect(nav.className).toContain('overflow-x-auto');
    expect(nav.className).not.toContain('flex-wrap');
    expect(screen.getByRole('button', { name: /Webhooks/ })).toBeTruthy();
    const cta = screen.getByTestId('north-star-cta');
    expect(cta.textContent).toContain('Add webhook');
    fireEvent.click(cta);
    expect(screen.getByText('webhooks panel create:open')).toBeTruthy();
    expect(screen.queryByTestId('north-star-cta')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Close form' }));
    expect(screen.getByTestId('north-star-cta')).toBeTruthy();
  });
});
