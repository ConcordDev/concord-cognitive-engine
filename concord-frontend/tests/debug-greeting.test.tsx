/**
 * Debug workspace northstar greeting.
 *
 * The Debug concept (docs/lens-northstar/30) opens on the serif
 * headline "What broke, Ramaj" above a quiet status card. This pins
 * the workspace header carrying it with the signed-in username. The
 * tool panels are mocked away — the greeting lives in the
 * workspace's own header.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({ user: { username: 'ramaj' } }),
}));
vi.mock('@/hooks/useLensCommand', () => ({ useLensCommand: () => {} }));
vi.mock('@/hooks/useLensIdentity', () => ({ useLensIdentity: () => {} }));
vi.mock('@/hooks/useRealtimeLens', () => ({
  useRealtimeLens: () => ({ latestData: null, insights: [], isLive: false, lastUpdated: null }),
}));
vi.mock('@/lib/lens-state-persistence', () => ({
  useLensStatePersistence: () => ({ restore: () => null, persist: () => {} }),
}));
vi.mock('@/store/ui', () => ({
  useUIStore: Object.assign(() => ({}), { getState: () => ({ addToast: () => {} }) }),
}));
vi.mock('@/components/lens/DTUExportButton', () => ({ DTUExportButton: () => null }));
vi.mock('@/components/lens/LiveIndicator', () => ({ LiveIndicator: () => null }));
vi.mock('@/components/lens/RealtimeDataPanel', () => ({ RealtimeDataPanel: () => null }));
vi.mock('@/components/debug/StatusPanel', () => ({ StatusPanel: () => null }));
vi.mock('@/components/debug/IssuesPanel', () => ({ IssuesPanel: () => null }));
vi.mock('@/components/debug/TracesPanel', () => ({ TracesPanel: () => null }));
vi.mock('@/components/debug/MetricsPanel', () => ({ MetricsPanel: () => null }));
vi.mock('@/components/debug/ReleasesPanel', () => ({ ReleasesPanel: () => null }));
vi.mock('@/components/debug/EventsPanel', () => ({ EventsPanel: () => null }));
vi.mock('@/components/debug/LogsPanel', () => ({ LogsPanel: () => null }));
vi.mock('@/components/debug/InspectorPanel', () => ({ InspectorPanel: () => null }));
vi.mock('@/components/debug/ContextInspectorPanel', () => ({ ContextInspectorPanel: () => null }));
vi.mock('@/components/debug/MonitoringPanel', () => ({ MonitoringPanel: () => null }));
vi.mock('@/components/debug/ComputeDeskPanel', () => ({ ComputeDeskPanel: () => null }));
vi.mock('@/components/debug/TemplatesPanel', () => ({ TemplatesPanel: () => null }));
vi.mock('@/components/debug/CvePanel', () => ({ CvePanel: () => null }));
vi.mock('@/components/debug/TestConsolePanel', () => ({ TestConsolePanel: () => null }));

import { DebugWorkspace } from '@/components/debug/DebugWorkspace';

describe('Debug workspace greeting', () => {
  it('opens on the concept headline addressed to the signed-in user', () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <DebugWorkspace />
      </QueryClientProvider>,
    );
    const greeting = screen.getByTestId('debug-greeting');
    expect(greeting.textContent).toBe('What broke, ramaj');
    expect(greeting.className).toContain('font-vault');
  });
});
