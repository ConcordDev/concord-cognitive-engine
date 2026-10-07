import { beforeEach, describe, expect, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import React from 'react';

const persist = vi.fn();
const refetchQueries = vi.fn();
let restoredState: Record<string, unknown> | null = null;

vi.mock('@tanstack/react-query', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, useQueryClient: () => ({ refetchQueries }) };
});
vi.mock('@/lib/lens-state-persistence', () => ({
  useLensStatePersistence: () => ({ restore: () => restoredState, persist, clear: vi.fn() }),
}));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: { username: 'ramaj' } }) }));
vi.mock('@/hooks/useRealtimeLens', () => ({
  useRealtimeLens: () => ({ latestData: { event: 'debug:update' }, isLive: true, lastUpdated: 1, insights: [] }),
}));
vi.mock('@/hooks/useLensNav', () => ({ useLensNav: () => {} }));
vi.mock('@/hooks/useLensCommand', () => ({ useLensCommand: () => {} }));
vi.mock('@/hooks/useLensIdentity', () => ({ useLensIdentity: () => {} }));
vi.mock('@/store/ui', () => ({ useUIStore: { getState: () => ({ addToast: vi.fn() }) } }));

vi.mock('@/components/lens/LensShell', () => ({
  LensShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock('@/components/lens/LiveIndicator', () => ({ LiveIndicator: () => <div data-testid="live-indicator" /> }));
vi.mock('@/components/lens/DTUExportButton', () => ({ DTUExportButton: () => <button>Export DTU</button> }));
vi.mock('@/components/lens/RealtimeDataPanel', () => ({ RealtimeDataPanel: () => <div data-testid="realtime-panel" /> }));

vi.mock('@/components/debug/StatusPanel', () => ({ StatusPanel: () => <div data-testid="status-panel" /> }));
vi.mock('@/components/debug/IssuesPanel', () => ({ IssuesPanel: () => <div data-testid="issues-panel" /> }));
vi.mock('@/components/debug/TracesPanel', () => ({ TracesPanel: () => <div data-testid="traces-panel" /> }));
vi.mock('@/components/debug/MetricsPanel', () => ({ MetricsPanel: () => <div data-testid="metrics-panel" /> }));
vi.mock('@/components/debug/ReleasesPanel', () => ({ ReleasesPanel: () => <div data-testid="releases-panel" /> }));
vi.mock('@/components/debug/EventsPanel', () => ({ EventsPanel: () => <div data-testid="events-panel" /> }));
vi.mock('@/components/debug/LogsPanel', () => ({ LogsPanel: () => <div data-testid="logs-panel" /> }));
vi.mock('@/components/debug/InspectorPanel', () => ({ InspectorPanel: () => <div data-testid="inspector-panel" /> }));
vi.mock('@/components/debug/ContextInspectorPanel', () => ({ ContextInspectorPanel: () => <div data-testid="context-panel" /> }));
vi.mock('@/components/debug/MonitoringPanel', () => ({ MonitoringPanel: () => <div data-testid="monitoring-panel" /> }));
vi.mock('@/components/debug/ComputeDeskPanel', () => ({ ComputeDeskPanel: () => <div data-testid="compute-panel" /> }));
vi.mock('@/components/debug/TemplatesPanel', () => ({ TemplatesPanel: () => <div data-testid="templates-panel" /> }));
vi.mock('@/components/debug/CvePanel', () => ({ CvePanel: () => <div data-testid="cve-panel" /> }));
vi.mock('@/components/debug/TestConsolePanel', () => ({ TestConsolePanel: () => <div data-testid="test-panel" /> }));

vi.mock('framer-motion', () => ({
  motion: new Proxy({}, { get: () => ({ children, ...props }: Record<string, unknown>) => <div {...props}>{children as React.ReactNode}</div> }),
  useReducedMotion: () => false,
}));
vi.mock('lucide-react', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  const make = (name: string) => {
    const Icon = (props: Record<string, unknown>) => <span data-testid={`icon-${name}`} {...props} />;
    return Icon;
  };
  return new Proxy(actual, {
    get: (target, prop: string) => (prop in target ? make(prop) : (target as Record<string, unknown>)[prop]),
  });
});

import DebugLensPage from '@/app/lenses/debug/page';

beforeEach(() => {
  restoredState = null;
  persist.mockReset();
  refetchQueries.mockReset();
});

describe('debug lens — one observability workspace', () => {
  it('opens on the real runtime overview with one grouped navigation rail', () => {
    render(<DebugLensPage />);
    expect(screen.getByRole('heading', { name: 'Observe the system, Ramaj' })).toBeInTheDocument();
    expect(screen.getByTestId('status-panel')).toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: 'Debug tools' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Issues/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Diagnostics/ })).toBeInTheDocument();
    expect(screen.queryByTestId('realtime-panel')).not.toBeInTheDocument();
  });

  it('persists the selected tool and exposes realtime data only in Live feed', () => {
    render(<DebugLensPage />);
    fireEvent.click(screen.getByRole('button', { name: /Live feed/ }));
    expect(persist).toHaveBeenCalledWith({ tool: 'live' });
    expect(screen.getByText(/not an external APM collector/i)).toBeInTheDocument();
    expect(screen.getByTestId('realtime-panel')).toBeInTheDocument();
  });

  it('restores exactly one persisted tool after reload', () => {
    restoredState = { tool: 'traces' };
    render(<DebugLensPage />);
    expect(screen.getByTestId('traces-panel')).toBeInTheDocument();
    expect(screen.queryByTestId('status-panel')).not.toBeInTheDocument();
  });
});
