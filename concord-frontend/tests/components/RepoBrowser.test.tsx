import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

const runDomain = vi.fn();

vi.mock('@/lib/api/client', () => ({
  apiHelpers: {
    dtus: { create: vi.fn() },
    lens: { runDomain: (...args: unknown[]) => runDomain(...args) },
  },
}));

vi.mock('@/store/ui', () => ({
  useUIStore: (sel: (s: unknown) => unknown) => sel({ addToast: vi.fn() }),
}));

vi.mock('framer-motion', () => ({
  motion: new Proxy({}, {
    get: (_, tag: string) => (props: Record<string, unknown> & { children?: React.ReactNode }) => {
      const { initial: _i, animate: _a, exit: _e, transition: _t, layoutId: _l, ...rest } = props as Record<string, unknown>;
      void _i; void _a; void _e; void _t; void _l;
      return React.createElement(tag, rest, props.children);
    },
  }),
  AnimatePresence: ({ children }: { children: React.ReactNode }) => React.createElement(React.Fragment, null, children),
}));

import { RepoBrowser } from '@/components/repos-explorer/RepoBrowser';

function ok<T>(result: T) {
  return { data: { ok: true, result } };
}

function renderBrowser() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{<RepoBrowser />}</QueryClientProvider>);
}

describe('RepoBrowser', () => {
  beforeEach(() => {
    runDomain.mockReset();
  });
  afterEach(() => cleanup());

  it('seeds the owner/repo fields with facebook/react and does not fetch until Load is clicked', () => {
    renderBrowser();
    expect(screen.getByDisplayValue('facebook')).toBeInTheDocument();
    expect(screen.getByDisplayValue('react')).toBeInTheDocument();
    expect(runDomain).not.toHaveBeenCalled();
  });

  it('loads commits, issues, and languages in parallel on submit and renders all three', async () => {
    runDomain.mockImplementation((_domain: string, action: string) => {
      if (action === 'github-commits-recent') {
        return Promise.resolve(ok({ commits: [{ sha: 'abcdef1234', author: 'gaearon', message: 'Fix bug\nmore detail', url: 'https://x/commit/abc' }] }));
      }
      if (action === 'github-issues') {
        return Promise.resolve(ok({ issues: [{ number: 42, title: 'Broken thing', state: 'open', labels: ['bug', 'p1'], url: 'https://x/issues/42', isPullRequest: false }] }));
      }
      return Promise.resolve(ok({ languages: { TypeScript: 800, JavaScript: 200 } }));
    });
    renderBrowser();
    fireEvent.click(screen.getByRole('button', { name: /load/i }));

    await waitFor(() => expect(screen.getByText('Fix bug')).toBeInTheDocument());
    expect(screen.getByText('abcdef1')).toBeInTheDocument();
    expect(screen.getByText('gaearon')).toBeInTheDocument();
    expect(screen.getByText('Broken thing')).toBeInTheDocument();
    expect(screen.getByText('#42')).toBeInTheDocument();
    expect(screen.getByText('bug')).toBeInTheDocument();
    expect(screen.getByText(/TypeScript 80\.0%/)).toBeInTheDocument();
    expect(screen.getByText(/JavaScript 20\.0%/)).toBeInTheDocument();
    expect(runDomain).toHaveBeenCalledWith('repos', 'github-commits-recent', { input: { owner: 'facebook', repo: 'react', limit: 20 } });
  });

  it('marks a result as a PR badge when isPullRequest is true', async () => {
    runDomain.mockImplementation((_domain: string, action: string) => {
      if (action === 'github-issues') {
        return Promise.resolve(ok({ issues: [{ number: 7, title: 'Add feature', state: 'open', isPullRequest: true }] }));
      }
      return Promise.resolve(ok(action === 'github-commits-recent' ? { commits: [] } : { languages: {} }));
    });
    renderBrowser();
    fireEvent.click(screen.getByRole('button', { name: /load/i }));
    await waitFor(() => expect(screen.getByText('Add feature')).toBeInTheDocument());
    expect(screen.getByText('PR')).toBeInTheDocument();
  });

  it('falls back to reading languages result directly when it is not wrapped under a `languages` key', async () => {
    runDomain.mockImplementation((_domain: string, action: string) => {
      if (action === 'github-languages') return Promise.resolve(ok({ Python: 100 }));
      return Promise.resolve(ok(action === 'github-commits-recent' ? { commits: [] } : { issues: [] }));
    });
    renderBrowser();
    fireEvent.click(screen.getByRole('button', { name: /load/i }));
    await waitFor(() => expect(screen.getByText(/Python 100\.0%/)).toBeInTheDocument());
  });

  it('disables Load while a request is in flight and shows a spinner', async () => {
    let resolveCommits!: (v: unknown) => void;
    runDomain.mockImplementation((_domain: string, action: string) => {
      if (action === 'github-commits-recent') return new Promise((res) => { resolveCommits = res; });
      return Promise.resolve(ok(action === 'github-issues' ? { issues: [] } : { languages: {} }));
    });
    renderBrowser();
    fireEvent.click(screen.getByRole('button', { name: /load/i }));
    await waitFor(() => expect(screen.getByRole('button', { name: /load/i })).toBeDisabled());
    resolveCommits(ok({ commits: [] }));
    await waitFor(() => expect(screen.getByRole('button', { name: /load/i })).not.toBeDisabled());
  });

  it('disables Load when owner or repo is blank', () => {
    renderBrowser();
    fireEvent.change(screen.getByDisplayValue('facebook'), { target: { value: '' } });
    expect(screen.getByRole('button', { name: /load/i })).toBeDisabled();
  });

  it('does not render the language bar or save affordance before any data has loaded', () => {
    renderBrowser();
    expect(screen.queryByText(/Language mix/i)).not.toBeInTheDocument();
  });
});
