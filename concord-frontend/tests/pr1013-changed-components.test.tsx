import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

const mocks = vi.hoisted(() => ({
  apiPost: vi.fn(),
  lensRun: vi.fn(),
  queryState: {
    data: undefined as unknown,
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  },
}));

vi.mock('@/lib/api/client', () => ({
  api: { post: mocks.apiPost, get: vi.fn() },
  lensRun: mocks.lensRun,
}));
vi.mock('@tanstack/react-query', () => ({
  useQuery: () => mocks.queryState,
}));
vi.mock('@/hooks/useLensNav', () => ({ useLensNav: vi.fn() }));
vi.mock('@/hooks/useLensCommand', () => ({ useLensCommand: vi.fn() }));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: { username: 'ada' } }) }));
vi.mock('@/components/lens/LensShell', () => ({
  LensShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock('@/components/lens/FirstRunTour', () => ({ FirstRunTour: () => null }));
vi.mock('@/components/lens/DepthBadge', () => ({ DepthBadge: () => null }));
vi.mock('@/components/lens/ShellPreview', () => ({ ShellPreview: () => null }));
vi.mock('@/components/lens/SessionRail', () => ({ SessionRail: () => null }));
vi.mock('@/components/code/CodeProjectContext', () => ({
  CodeProjectProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock('@/components/code/CodeEditorWorkspacePanel', () => ({
  CodeEditorWorkspacePanel: ({ onOpenExtras }: { onOpenExtras: () => void }) => (
    <button onClick={onOpenExtras}>open advanced</button>
  ),
}));
vi.mock('@/components/code/CodeAdvancedPanel', () => ({ CodeAdvancedPanel: () => <div>advanced panel</div> }));
vi.mock('@/components/code/GithubTrending', () => ({ GithubTrending: () => <div>trending panel</div> }));
vi.mock('@/components/code/CodeActionPanel', () => ({ CodeActionPanel: () => <div>actions panel</div> }));
vi.mock('@/components/panel-polish', () => ({
  PipingProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock('@/components/meta/meta-shared', () => ({
  baseName: (p: string) => p.split('/').at(-1),
  cardVariants: {},
  tabContentVariants: {},
  StatCard: ({ label, value }: { label: string; value: number }) => <div>{label}: {value}</div>,
  LoadingSpinner: ({ message }: { message: string }) => <div>{message}</div>,
  EmptyState: ({ message }: { message: string }) => <div>{message}</div>,
}));

vi.mock('@/components/productivity/ProductivityTodayPanel', () => ({ ProductivityTodayPanel: () => <div>Today content</div> }));
vi.mock('@/components/productivity/ProductivityTasksPanel', () => ({ ProductivityTasksPanel: () => <div>Tasks content</div> }));
vi.mock('@/components/productivity/ProductivityHabitsPanel', () => ({ ProductivityHabitsPanel: () => <div>Habits content</div> }));
vi.mock('@/components/productivity/ProductivityFocusPanel', () => ({ ProductivityFocusPanel: () => <div>Focus content</div> }));
vi.mock('@/components/productivity/ProductivityQuickAddPanel', () => ({ ProductivityQuickAddPanel: () => <div>QuickAdd content</div> }));
vi.mock('@/components/productivity/ProductivityRemindersPanel', () => ({ ProductivityRemindersPanel: () => <div>Reminders content</div> }));
vi.mock('@/components/productivity/ProductivityFiltersPanel', () => ({ ProductivityFiltersPanel: () => <div>Filters content</div> }));
vi.mock('@/components/productivity/ProductivityCalendarPanel', () => ({ ProductivityCalendarPanel: () => <div>Calendar content</div> }));
vi.mock('@/components/productivity/ProductivityCollabPanel', () => ({ ProductivityCollabPanel: () => <div>Collab content</div> }));

vi.mock('@/components/dtu/ContentClassLicenseFields', () => ({
  withContentLicense: (input: unknown) => input,
}));

import CodeApp from '@/components/code/CodeApp';
import { CrossLensRecentsPanel } from '@/components/lens/CrossLensRecentsPanel';
import { OverviewPanel } from '@/components/meta/OverviewPanel';
import { ProductivityTaskSection } from '@/components/productivity/ProductivityTaskSection';
import { WalletReceiptMenu } from '@/components/wallet/WalletReceiptMenu';

beforeEach(() => {
  mocks.apiPost.mockReset();
  mocks.lensRun.mockReset();
  mocks.queryState.data = undefined;
  mocks.queryState.isLoading = false;
  mocks.queryState.isError = false;
  mocks.queryState.refetch.mockReset();
});

describe('PR 1013 changed components', () => {
  it('switches every Code shell view and dispatches a real run event', () => {
    const dispatched = vi.spyOn(window, 'dispatchEvent');
    render(<CodeApp />);
    fireEvent.click(screen.getByRole('button', { name: /open advanced/i }));
    expect(screen.getByText('advanced panel')).toBeTruthy();
    fireEvent.click(screen.getByRole('tab', { name: /GitHub trending/i }));
    expect(screen.getByText('trending panel')).toBeTruthy();
    fireEvent.click(screen.getByRole('tab', { name: /Review workbench/i }));
    expect(screen.getByText('actions panel')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /^Run$/ }));
    expect(dispatched).toHaveBeenCalled();
  });

  it('renders, refreshes, and reports cross-lens results honestly', async () => {
    mocks.apiPost
      .mockResolvedValueOnce({ data: { ok: true, surfaces: [] } })
      .mockResolvedValueOnce({ data: { ok: false, reason: 'offline' } });
    render(<CrossLensRecentsPanel lensId="code" hideWhenEmpty={false} sinceDays={1} />);
    expect(await screen.findByText(/No DTUs surfaced/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Refresh items/i }));
    expect(await screen.findByText('offline')).toBeTruthy();
  });

  it('covers loading, error retry, populated, and empty inventory states', () => {
    mocks.queryState.isLoading = true;
    const { rerender } = render(<OverviewPanel />);
    expect(screen.getByText(/Loading inventory/)).toBeTruthy();

    mocks.queryState.isLoading = false;
    mocks.queryState.isError = true;
    rerender(<OverviewPanel />);
    fireEvent.click(screen.getByRole('button', { name: /Retry/i }));
    expect(mocks.queryState.refetch).toHaveBeenCalled();

    mocks.queryState.isError = false;
    mocks.queryState.data = {
      totalComponents: 2, totalLenses: 3, totalServerLibs: 4, totalRoutes: 5, orphanedCount: 1,
      largestFiles: [{ path: 'server/server.js', lineCount: 10 }],
      mostImportedComponents: [{ path: 'components/Button.tsx', usedByCount: 1 }],
    };
    rerender(<OverviewPanel />);
    expect(screen.getByText('Components: 2')).toBeTruthy();
    expect(screen.getByText('Button.tsx')).toBeTruthy();

    mocks.queryState.data = { ...mocks.queryState.data, largestFiles: [], mostImportedComponents: [] };
    rerender(<OverviewPanel />);
    expect(screen.getByText('No file data available.')).toBeTruthy();
    expect(screen.getByText('No import data available.')).toBeTruthy();
  });

  it('loads dashboard stats and switches all productivity panels', async () => {
    mocks.lensRun
      .mockResolvedValueOnce({ data: { result: { activeTasks: 3, dueToday: 1, projects: 2, habits: 4, completedToday: 5, focusMinutesToday: 30 } } })
      .mockResolvedValueOnce({ data: { result: { completedWeek: 8, streak: 2 } } });
    const changed = vi.fn();
    render(<ProductivityTaskSection onTabChange={changed} />);
    expect(await screen.findByText('2-day streak')).toBeTruthy();
    for (const label of ['Quick add', 'Tasks', 'Filters', 'Calendar', 'Reminders', 'Collaborate', 'Habits', 'Focus']) {
      fireEvent.click(screen.getByRole('button', { name: new RegExp(label, 'i') }));
    }
    expect(changed).toHaveBeenCalledTimes(8);
    expect(screen.getByText('Focus content')).toBeTruthy();
  });

  it('saves, verifies, and sends a ledger receipt to Finance', async () => {
    mocks.lensRun
      .mockResolvedValueOnce({ data: { ok: true, result: { dtu: { id: 'dtu_1' } } } })
      .mockResolvedValueOnce({ data: { ok: true, result: { dtu: { id: 'dtu_1' } } } })
      .mockResolvedValueOnce({ data: { ok: true, result: { receipt: { id: 'fin_1', citedDtuId: 'dtu_1' } } } });
    render(<WalletReceiptMenu receipt={{ kind: 'request', sourceId: 'req_1', amount: 12, batchId: 'batch_1', counterparty: 'u2' }} />);
    fireEvent.click(screen.getByRole('button', { name: /Save receipt/i }));
    expect(await screen.findByText(/Saved as private DTU dtu_1/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Send this DTU/i }));
    expect(await screen.findByRole('link', { name: /Open Finance receipt fin_1/i })).toHaveAttribute('href', '/lenses/finance');
  });

  it('shows wallet receipt failures without success-shaped fallback', async () => {
    mocks.lensRun.mockRejectedValueOnce(new Error('network down'));
    render(<WalletReceiptMenu receipt={{ kind: 'split', sourceId: 'split_1', amount: 4, batchId: 'batch_2', counterparty: 'u3' }} />);
    fireEvent.click(screen.getByRole('button', { name: /Save receipt/i }));
    await waitFor(() => expect(screen.getByText(/Not saved. network down/)).toBeTruthy());
  });
});
