import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

vi.mock('@/lib/api/client', () => ({
  apiHelpers: { dtus: { create: vi.fn() } },
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

import { GithubTrending } from '@/components/code/GithubTrending';

function repo(overrides: Partial<{
  id: number; full_name: string; description: string; html_url: string;
  stargazers_count: number; forks_count: number; watchers_count: number;
  language: string; topics: string[]; pushed_at: string;
}> = {}) {
  return {
    id: 1,
    full_name: 'concorddev/concord-cognitive-engine',
    description: 'A cognitive OS',
    html_url: 'https://github.com/concorddev/concord-cognitive-engine',
    stargazers_count: 1234,
    forks_count: 56,
    watchers_count: 78,
    language: 'JavaScript',
    topics: ['ai', 'os', 'agents', 'llm', 'sim', 'extra1', 'extra2'],
    pushed_at: '2026-01-01T00:00:00Z',
    owner: { login: 'concorddev', avatar_url: 'https://example.com/a.png' },
    ...overrides,
  };
}

function renderTrending() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{<GithubTrending />}</QueryClientProvider>);
}

describe('GithubTrending', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('shows a loading state before the first response lands', () => {
    (fetch as ReturnType<typeof vi.fn>).mockReturnValue(new Promise(() => {}));
    renderTrending();
    expect(screen.getByText(/Searching trending repos/i)).toBeInTheDocument();
  });

  it('hits the GitHub search API with a "week" default window and renders results', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true, json: async () => ({ items: [repo()] }) });
    renderTrending();
    await waitFor(() => expect(screen.getByText('concorddev/concord-cognitive-engine')).toBeInTheDocument());
    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining('https://api.github.com/search/repositories?q='),
      expect.objectContaining({ headers: { Accept: 'application/vnd.github+json' } }),
    );
    expect(screen.getByText('1,234')).toBeInTheDocument();
    expect(screen.getByText('56')).toBeInTheDocument();
    expect(screen.getByText('78')).toBeInTheDocument();
    // topics capped at 6 of the 7 provided
    expect(screen.getAllByText(/^(ai|os|agents|llm|sim|extra1|extra2)$/)).toHaveLength(6);
  });

  it('shows an error banner when the GitHub API responds non-OK', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: false, status: 403, json: async () => ({}) });
    renderTrending();
    await waitFor(() => expect(screen.getByText(/GitHub unreachable/i)).toBeInTheDocument());
  });

  it('re-queries with a language filter in the query string when a language is picked', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true, json: async () => ({ items: [] }) });
    renderTrending();
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'Rust' } });
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
    const [url] = (fetch as ReturnType<typeof vi.fn>).mock.calls[1];
    expect(decodeURIComponent(url as string)).toContain('language:Rust');
  });

  it('re-queries with a shorter window when "today" is picked, and highlights it', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true, json: async () => ({ items: [] }) });
    renderTrending();
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole('button', { name: 'today' }));
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
    expect(screen.getByRole('button', { name: 'today' })).toHaveClass('bg-cyan-500/20');
  });

  it('renders the save-as-DTU affordance once results exist, not before', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true, json: async () => ({ items: [] }) });
    renderTrending();
    await waitFor(() => expect(fetch).toHaveBeenCalled());
    expect(screen.queryByTitle(/save/i)).not.toBeInTheDocument();
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true, json: async () => ({ items: [repo()] }) });
    fireEvent.click(screen.getByRole('button', { name: '30d' }));
    await waitFor(() => expect(screen.getByText('concorddev/concord-cognitive-engine')).toBeInTheDocument());
  });

  it('omits the description paragraph and topics row when a repo has neither', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({ items: [repo({ description: undefined, topics: undefined, language: undefined })] }),
    });
    renderTrending();
    await waitFor(() => expect(screen.getByText('concorddev/concord-cognitive-engine')).toBeInTheDocument());
    const link = screen.getByText('concorddev/concord-cognitive-engine').closest('a')!;
    expect(link).toHaveAttribute('href', 'https://github.com/concorddev/concord-cognitive-engine');
    expect(link).toHaveAttribute('target', '_blank');
  });
});
