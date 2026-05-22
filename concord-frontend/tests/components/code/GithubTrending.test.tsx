import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

vi.mock('@/components/dtu/SaveAsDtuButton', () => ({
  SaveAsDtuButton: (props: Record<string, unknown>) =>
    React.createElement('div', { 'data-testid': 'save-dtu' }, String(props.title)),
}));

vi.mock('lucide-react', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  const make = (name: string) => {
    const Icon = React.forwardRef<SVGSVGElement, Record<string, unknown>>((props, ref) =>
      React.createElement('span', { 'data-testid': `icon-${name}`, ref, ...props })
    );
    Icon.displayName = name;
    return Icon;
  };
  const o: Record<string, unknown> = {};
  for (const k of Object.keys(actual)) {
    if (k[0] >= 'A' && k[0] <= 'Z' && k !== 'createLucideIcon' && k !== 'default') o[k] = make(k);
  }
  return { ...actual, ...o };
});

import { GithubTrending } from '@/components/code/GithubTrending';

const REPOS = [
  {
    id: 1,
    full_name: 'octo/repo',
    description: 'a cool repo',
    html_url: 'https://github.com/octo/repo',
    stargazers_count: 1234,
    forks_count: 56,
    watchers_count: 78,
    language: 'TypeScript',
    topics: ['cli', 'tool'],
    pushed_at: '2026-01-01',
    owner: { login: 'octo', avatar_url: '' },
  },
  {
    id: 2,
    full_name: 'foo/bar',
    html_url: 'https://github.com/foo/bar',
    stargazers_count: 9,
    forks_count: 1,
    watchers_count: 2,
    pushed_at: '2026-01-02',
    owner: { login: 'foo', avatar_url: '' },
  },
];

function renderTrending() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <GithubTrending />
    </QueryClientProvider>
  );
}

describe('GithubTrending', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('shows the loading state while pending', () => {
    global.fetch = vi.fn(() => new Promise(() => {})) as unknown as typeof fetch;
    renderTrending();
    expect(screen.getByText('Searching trending repos…')).toBeInTheDocument();
  });

  it('renders repos returned from the GitHub API', async () => {
    global.fetch = vi.fn(() =>
      Promise.resolve({ ok: true, json: () => Promise.resolve({ items: REPOS }) })
    ) as unknown as typeof fetch;
    renderTrending();
    await waitFor(() => expect(screen.getByText('octo/repo')).toBeInTheDocument());
    expect(screen.getByText('a cool repo')).toBeInTheDocument();
    expect(screen.getByText('foo/bar')).toBeInTheDocument();
    expect(screen.getByText('cli')).toBeInTheDocument();
    expect(screen.getByTestId('save-dtu')).toBeInTheDocument();
  });

  it('renders an error banner when the API fails', async () => {
    global.fetch = vi.fn(() =>
      Promise.resolve({ ok: false, status: 403, json: () => Promise.resolve({}) })
    ) as unknown as typeof fetch;
    renderTrending();
    await waitFor(() =>
      expect(screen.getByText('GitHub unreachable / rate-limited.')).toBeInTheDocument()
    );
  });

  it('refetches when the language filter changes', async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve({ ok: true, json: () => Promise.resolve({ items: REPOS }) })
    );
    global.fetch = fetchMock as unknown as typeof fetch;
    renderTrending();
    await waitFor(() => expect(screen.getByText('octo/repo')).toBeInTheDocument());
    const callsBefore = fetchMock.mock.calls.length;
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'Python' } });
    await waitFor(() => expect(fetchMock.mock.calls.length).toBeGreaterThan(callsBefore));
    const lastUrl = String(fetchMock.mock.calls.at(-1)![0]);
    expect(lastUrl).toContain('language%3APython');
  });

  it('refetches when the time-window button changes', async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve({ ok: true, json: () => Promise.resolve({ items: REPOS }) })
    );
    global.fetch = fetchMock as unknown as typeof fetch;
    renderTrending();
    await waitFor(() => expect(screen.getByText('octo/repo')).toBeInTheDocument());
    const callsBefore = fetchMock.mock.calls.length;
    fireEvent.click(screen.getByText('today'));
    await waitFor(() => expect(fetchMock.mock.calls.length).toBeGreaterThan(callsBefore));
  });

  it('handles an empty items array (no SaveAsDtuButton)', async () => {
    global.fetch = vi.fn(() =>
      Promise.resolve({ ok: true, json: () => Promise.resolve({ items: [] }) })
    ) as unknown as typeof fetch;
    renderTrending();
    await waitFor(() =>
      expect(screen.getByText('Trending repositories')).toBeInTheDocument()
    );
    expect(screen.queryByTestId('save-dtu')).not.toBeInTheDocument();
  });
});
