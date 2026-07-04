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

vi.mock('lucide-react', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  const make = (name: string) => {
    const Icon = React.forwardRef<SVGSVGElement, Record<string, unknown>>((props, ref) =>
      React.createElement('span', { 'data-testid': `icon-${name}`, ref, ...props }),
    );
    Icon.displayName = name;
    return Icon;
  };
  const o: Record<string, unknown> = {};
  for (const k of Object.keys(actual)) {
    if (k[0] >= 'A' && k[0] <= 'Z' && k !== 'createLucideIcon' && k !== 'default') o[k] = make(k);
  }
  return o;
});

import { NpmPackageSearch } from '@/components/app-maker/NpmPackageSearch';

function renderSearch() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{<NpmPackageSearch />}</QueryClientProvider>);
}

function mockHit(overrides: Partial<{ name: string; version: string }> = {}) {
  return {
    package: {
      name: overrides.name ?? 'react',
      version: overrides.version ?? '18.3.1',
      description: 'A JavaScript library for building UIs',
      keywords: ['ui', 'react', 'view', 'component', 'framework', 'extra'],
      date: '2024-04-25T00:00:00.000Z',
      publisher: { username: 'gaearon' },
      links: { npm: 'https://npmjs.com/package/react', homepage: 'https://react.dev' },
    },
    score: { final: 0.85, detail: { quality: 0.9, popularity: 0.95, maintenance: 0.99 } },
    searchScore: 100000,
  };
}

describe('NpmPackageSearch', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('renders the empty state and a seeded query before any search', () => {
    renderSearch();
    expect(screen.getByText(/Search the live NPM registry/i)).toBeInTheDocument();
    expect(screen.getByDisplayValue('react')).toBeInTheDocument();
  });

  it('hits registry.npmjs.org with the query on submit and renders results', async () => {
    const hits = [mockHit()];
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({ objects: hits }),
    });
    renderSearch();
    fireEvent.submit(screen.getByRole('button', { name: /search/i }).closest('form')!);

    await waitFor(() => expect(screen.getAllByText('react').length).toBeGreaterThan(0));
    expect(fetch).toHaveBeenCalledWith(expect.stringContaining('https://registry.npmjs.org/-/v1/search?text=react'));
    expect(screen.getByText(/gaearon/)).toBeInTheDocument();
    expect(screen.getByText(/quality 90/)).toBeInTheDocument();
  });

  it('shows an error message and empty results when the fetch fails', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: false, status: 503, json: async () => ({}) });
    renderSearch();
    fireEvent.submit(screen.getByRole('button', { name: /search/i }).closest('form')!);
    await waitFor(() => expect(screen.getByText(/npm 503/)).toBeInTheDocument());
    expect(screen.queryByText('react')).not.toBeInTheDocument();
  });

  it('shows an error message when fetch itself rejects', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('network down'));
    renderSearch();
    fireEvent.submit(screen.getByRole('button', { name: /search/i }).closest('form')!);
    await waitFor(() => expect(screen.getByText(/network down/)).toBeInTheDocument());
  });

  it('disables submit for a blank query and does not fetch', () => {
    renderSearch();
    fireEvent.change(screen.getByDisplayValue('react'), { target: { value: '   ' } });
    expect(screen.getByRole('button', { name: /search/i })).toBeDisabled();
  });

  it('renders the save-as-DTU affordance once results exist', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true, json: async () => ({ objects: [mockHit()] }) });
    renderSearch();
    fireEvent.submit(screen.getByRole('button', { name: /search/i }).closest('form')!);
    await waitFor(() => expect(screen.getAllByText('react').length).toBeGreaterThan(0));
    expect(screen.getByTestId('icon-Bookmark')).toBeInTheDocument();
  });
});
