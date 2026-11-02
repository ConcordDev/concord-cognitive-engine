/**
 * Database page northstar greeting.
 *
 * The Database concept (docs/lens-northstar/32) opens on the serif
 * headline "Ask the data, Ramaj" above the SQL console. This pins
 * the page header carrying it with the signed-in username. The
 * workspace panels are mocked away — the greeting lives in the
 * page's own header.
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
vi.mock('@/components/database/ProjectsPanel', () => ({ ProjectsPanel: () => null }));

import DatabaseLensPage from '@/app/lenses/database/page';

describe('Database page greeting', () => {
  it('opens on the concept headline addressed to the signed-in user', () => {
    render(<DatabaseLensPage />);
    const greeting = screen.getByTestId('database-greeting');
    expect(greeting.textContent).toBe('Ask the data, ramaj');
    expect(greeting.className).toContain('font-vault');
  });
});
