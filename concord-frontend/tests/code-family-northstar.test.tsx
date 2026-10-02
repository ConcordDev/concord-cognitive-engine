/**
 * Code family north stars (docs/lens-northstar/28, 30, 32, 34).
 * Each lens opens on one surface: a buffer, an issue list, a query, a repo list.
 * Counts and rows come from the mocked macro envelope, never a baked number.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { KeyboardProvider } from '@/lib/keyboard';

vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({
    user: { id: 'u1', username: 'ramaj', email: 'r@x', role: 'owner' },
    isLoading: false,
    isAuthenticated: true,
    logout: async () => {},
    refresh: async () => {},
  }),
}));

vi.mock('@/components/code/CodeEditorWorkspacePanel', () => ({
  CodeEditorWorkspacePanel: () => <div data-testid="code-buffer">untitled.js</div>,
}));

vi.mock('@/components/lens/CrossLensRecentsPanel', () => ({
  CrossLensRecentsPanel: () => null,
}));

const lensRunMock = vi.fn();

vi.mock('@/lib/api/client', () => ({
  lensRun: (...args: unknown[]) => lensRunMock(...args),
  api: { get: vi.fn(), post: vi.fn() },
  apiHelpers: { graph: { query: vi.fn() } },
}));

import CodeApp from '@/components/code/CodeApp';
import DebugLensPage from '@/app/lenses/debug/page';
import DatabaseLensPage from '@/app/lenses/database/page';
import ReposLensPage from '@/app/lenses/repos/page';

function actionOf(args: unknown[]): string {
  const first = args[0];
  if (typeof first === 'string') return String(args[1] || '');
  return String((first as { action?: string })?.action || '');
}

function ok(result: unknown) {
  return { data: { ok: true, result, error: null } };
}

function renderInShell(ui: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <KeyboardProvider>{ui}</KeyboardProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  lensRunMock.mockReset();
  lensRunMock.mockImplementation((...args: unknown[]) => {
    const action = actionOf(args);
    if (action === 'issue-list') return Promise.resolve(ok({ issues: [], summary: { open: 0, resolved: 0, ignored: 0, totalOccurrences: 0 } }));
    if (action === 'connection-list') return Promise.resolve(ok({ connections: [], count: 0 }));
    if (action === 'schema-dashboard') return Promise.resolve(ok({ schemas: 0, totalTables: 0, totalRelations: 0 }));
    if (action === 'repo-list') return Promise.resolve(ok({ repos: [] }));
    return Promise.resolve(ok({}));
  });
});

describe('code family north stars', () => {
  it('code opens on a buffer, not the analysis desk', () => {
    renderInShell(<CodeApp />);
    expect(screen.getByRole('heading', { name: 'What are we building, Ramaj' })).toBeTruthy();
    expect(screen.getByTestId('code-buffer')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Debug' }).getAttribute('href')).toBe('/lenses/debug');
    expect(screen.queryByText(/Complexity/i)).toBeNull();
    expect(screen.queryByText(/Advanced IDE/i)).toBeNull();
  });

  it('debug opens on an honest empty issue list with Refresh', async () => {
    renderInShell(<DebugLensPage />);
    expect(screen.getByRole('heading', { name: 'What broke, Ramaj' })).toBeTruthy();
    expect(await screen.findByText('No open issue')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Refresh' })).toBeTruthy();
    expect(screen.queryByText(/Sentry/i)).toBeNull();
    expect(screen.queryByText(/Service tiles/i)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'More' }));
    expect(screen.getByRole('menuitem', { name: /Status/ })).toBeTruthy();
  });

  it('database is one query surface and does not invent a table count', async () => {
    renderInShell(<DatabaseLensPage />);
    expect(screen.getByRole('heading', { name: 'Ask the data, Ramaj' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Run query' })).toBeTruthy();
    expect(await screen.findByText(/No connection yet/)).toBeTruthy();
    expect(screen.queryByText(/459/)).toBeNull();
    expect(screen.queryByText(/Database Administration/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Run query' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/Write a statement/);
  });

  it('repos shows the real empty list and hides GitHub explore', async () => {
    renderInShell(<ReposLensPage />);
    expect(screen.getByRole('heading', { name: 'Your repos, Ramaj' })).toBeTruthy();
    expect(await screen.findByText(/No repos yet/)).toBeTruthy();
    expect(screen.getByText('Substrate · 0 repos')).toBeTruthy();
    expect(screen.queryByText(/Explore GitHub/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'New repo' }));
    expect(screen.getByLabelText('New repo name')).toBeTruthy();
  });

  it('database Run query calls query-run once a connection exists', async () => {
    lensRunMock.mockImplementation((...args: unknown[]) => {
      const action = actionOf(args);
      if (action === 'connection-list') {
        return Promise.resolve(ok({ connections: [{ id: 'c1', name: 'local', engine: 'in-memory', datasetCount: 1 }], count: 1 }));
      }
      if (action === 'schema-dashboard') return Promise.resolve(ok({ schemas: 1, totalTables: 2, totalRelations: 0 }));
      if (action === 'query-run') {
        return Promise.resolve(ok({ columns: ['name'], rows: [{ name: 'users' }], rowCount: 1, success: true, durationMs: 1 }));
      }
      return Promise.resolve(ok({}));
    });
    renderInShell(<DatabaseLensPage />);
    const box = await screen.findByLabelText('SQL');
    fireEvent.change(box, { target: { value: 'SELECT name FROM datasets' } });
    fireEvent.click(screen.getByRole('button', { name: 'Run query' }));
    await waitFor(() => {
      const ran = lensRunMock.mock.calls.some((c) => actionOf(c) === 'query-run');
      expect(ran).toBe(true);
    });
    expect(await screen.findByText('users')).toBeTruthy();
    expect(await screen.findByText(/2 tables in your schemas/)).toBeTruthy();
  });
});
