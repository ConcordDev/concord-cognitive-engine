import { beforeEach, describe, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';

const lensRun = vi.fn();
const persist = vi.fn();
let restoredState: Record<string, unknown> | null = null;

vi.mock('@/lib/api/client', () => ({ lensRun: (...args: unknown[]) => lensRun(...args) }));
vi.mock('@/lib/lens-state-persistence', () => ({
  useLensStatePersistence: () => ({ restore: () => restoredState, persist, clear: vi.fn() }),
}));
vi.mock('@/hooks/useRealtimeLens', () => ({
  useRealtimeLens: () => ({ latestData: null, isLive: false, lastUpdated: null, insights: [] }),
}));
vi.mock('@/hooks/useLensCommand', () => ({ useLensCommand: () => {} }));
vi.mock('@/hooks/useLensIdentity', () => ({ useLensIdentity: () => {} }));
vi.mock('@/components/lens/LiveIndicator', () => ({ LiveIndicator: () => null }));
vi.mock('@/components/lens/DTUExportButton', () => ({ DTUExportButton: () => null }));
vi.mock('@/components/lens/RealtimeDataPanel', () => ({ RealtimeDataPanel: () => null }));
vi.mock('@/components/panel-polish', () => ({ PipingProvider: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
vi.mock('framer-motion', () => ({
  motion: new Proxy({}, { get: () => ({ children, ...props }: Record<string, unknown>) => <div {...props}>{children as React.ReactNode}</div> }),
}));
vi.mock('@/components/defense/MissionPlanner', () => ({ MissionPlanner: () => <div data-testid="MissionPlanner" /> }));
vi.mock('@/components/defense/ThreatBoard', () => ({ ThreatBoard: () => <div data-testid="ThreatBoard" /> }));
vi.mock('@/components/defense/PersonnelRoster', () => ({ PersonnelRoster: () => <div data-testid="PersonnelRoster" /> }));
vi.mock('@/components/defense/LogisticsBoard', () => ({ LogisticsBoard: () => <div data-testid="LogisticsBoard" /> }));
vi.mock('@/components/defense/CommsLog', () => ({ CommsLog: () => <div data-testid="CommsLog" /> }));
vi.mock('@/components/defense/ContractSearch', () => ({ ContractSearch: () => <div data-testid="ContractSearch" /> }));
vi.mock('@/components/defense/DefenseActionPanel', () => ({ DefenseActionPanel: () => <div data-testid="DefenseActionPanel" /> }));
vi.mock('@/components/defense/ResourceAllocationPanel', () => ({ ResourceAllocationPanel: () => <div data-testid="ResourceAllocationPanel" /> }));
vi.mock('@/components/defense/AssetReadiness', () => ({ AssetReadiness: () => <div data-testid="asset-readiness" /> }));
vi.mock('@/components/defense/DashboardStats', () => ({ DashboardStats: () => <div data-testid="overview" /> }));
vi.mock('@/components/defense/CommonOperatingPicture', () => ({
  CommonOperatingPicture: () => { throw new Error("Cannot read properties of null (reading 'toFixed')"); },
}));

import { DefenseWorkspace } from '@/components/defense/DefenseWorkspace';

beforeEach(() => {
  lensRun.mockReset(); persist.mockReset();
  restoredState = { opened: true, tool: 'map' };
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('defense lens cannot brick on a remembered view', () => {
  it('a crashing remembered Map shows a way back to Assets, and the choice is remembered', () => {
    render(<DefenseWorkspace />);
    expect(screen.getByRole('alert')).toHaveTextContent('This view failed to render');
    fireEvent.click(screen.getByRole('button', { name: 'Open Assets' }));
    expect(screen.getByTestId('asset-readiness')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(persist).toHaveBeenCalledWith({ opened: true, tool: 'assets' });
  });

  it('Back to Overview also recovers', () => {
    render(<DefenseWorkspace />);
    fireEvent.click(screen.getByRole('button', { name: 'Back to Overview' }));
    expect(screen.getByTestId('overview')).toBeInTheDocument();
  });
});
