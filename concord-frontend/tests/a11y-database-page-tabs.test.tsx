/// <reference types="@testing-library/jest-dom/vitest" />
/**
 * FIX-database-007 (page leg) — the database lens tab nav buttons meet the
 * 40px platform tap-target floor. Panels are mocked away (the greeting
 * suite's pattern); the tab bar is the page's own chrome.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';

vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({ user: { username: 'ramaj' } }),
}));
vi.mock('@/hooks/useLensNav', () => ({ useLensNav: () => {} }));
vi.mock('@/hooks/useLensCommand', () => ({ useLensCommand: () => {} }));
vi.mock('@/hooks/useLensIdentity', () => ({ useLensIdentity: () => {} }));
vi.mock('@/hooks/useRealtimeLens', () => ({
  useRealtimeLens: () => ({ latestData: null, insights: [], alerts: [], isLive: false, lastUpdated: null }),
}));
vi.mock('@/components/lens/LensShell', () => ({
  LensShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock('@/components/lens/CrossLensRecentsPanel', () => ({ CrossLensRecentsPanel: () => null }));
vi.mock('@/components/lens/DepthBadge', () => ({ DepthBadge: () => null }));
vi.mock('@/components/lens/LiveIndicator', () => ({ LiveIndicator: () => null }));
vi.mock('@/components/lens/DTUExportButton', () => ({ DTUExportButton: () => null }));
vi.mock('@/components/database/ConnectionStrip', () => ({ ConnectionStrip: () => null }));
vi.mock('@/components/database/LiveClientPanel', () => ({ LiveClientPanel: () => null }));
vi.mock('@/components/database/QueryEditorPanel', () => ({ QueryEditorPanel: () => null }));
vi.mock('@/components/database/TableBrowserPanel', () => ({ TableBrowserPanel: () => null }));
vi.mock('@/components/database/SchemaMapPanel', () => ({ SchemaMapPanel: () => null }));
vi.mock('@/components/database/DesignerPanel', () => ({ DesignerPanel: () => null }));
vi.mock('@/components/database/IndexesPanel', () => ({ IndexesPanel: () => null }));
vi.mock('@/components/database/MonitoringPanel', () => ({ MonitoringPanel: () => null }));
vi.mock('@/components/database/HistoryPanel', () => ({ HistoryPanel: () => null }));
vi.mock('@/components/database/AnalysisPanel', () => ({ AnalysisPanel: () => null }));
vi.mock('@/components/database/ProjectsPanel', () => ({ ProjectsPanel: () => null }));

import DatabaseLensPage from '@/app/lenses/database/page';

describe('FIX-database-007 — page tab targets', () => {
  it('every database view tab button carries the 40px floor class', () => {
    render(<DatabaseLensPage />);
    const nav = screen.getByRole('navigation', { name: 'Database views' });
    const buttons = Array.from(nav.querySelectorAll('button'));
    expect(buttons.length).toBe(10);
    for (const b of buttons) {
      expect(b.className).toContain('min-h-[40px]');
    }
  });
});
