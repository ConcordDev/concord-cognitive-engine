import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

const runDomain = vi.fn();
const addToast = vi.fn();
const create = vi.fn();

vi.mock('@/lib/api/client', () => ({
  apiHelpers: {
    lens: { runDomain: (...args: unknown[]) => runDomain(...args) },
    dtus: { create: (...args: unknown[]) => create(...args) },
  },
}));
vi.mock('@/store/ui', () => ({ useUIStore: (sel: (s: unknown) => unknown) => sel({ addToast }) }));
vi.mock('framer-motion', () => ({
  motion: new Proxy({}, {
    get: (_, tag: string) => (props: Record<string, unknown> & { children?: React.ReactNode }) => {
      const { initial: _i, animate: _a, exit: _e, transition: _t, layout: _l, ...rest } = props as Record<string, unknown>;
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

import { WikipediaExplorer } from '@/components/history/WikipediaExplorer';

function renderWithQuery(node: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{node}</QueryClientProvider>);
}

describe('WikipediaExplorer', () => {
  beforeEach(() => {
    runDomain.mockReset();
    addToast.mockReset();
    create.mockReset();
    vi.useFakeTimers();
  });

  it('renders search mode by default with empty state', () => {
    renderWithQuery(<WikipediaExplorer />);
    expect(screen.getByPlaceholderText(/Lincoln/i)).toBeInTheDocument();
    expect(screen.getByText(/opensearch fires after 2 characters/i)).toBeInTheDocument();
  });

  it('debounces opensearch + shows suggestion dropdown', async () => {
    runDomain.mockResolvedValue({ data: { ok: true, result: { ok: true, result: { results: [
      { title: 'Lincoln', description: 'a city in Lincolnshire' },
      { title: 'Abraham Lincoln', description: '16th US President' },
    ] } } } });
    renderWithQuery(<WikipediaExplorer />);
    fireEvent.change(screen.getByPlaceholderText(/Lincoln/i), { target: { value: 'linc' } });
    vi.advanceTimersByTime(250);
    await vi.waitFor(() => expect(runDomain).toHaveBeenCalled());
    vi.useRealTimers();
    await waitFor(() => expect(screen.getByText('Abraham Lincoln')).toBeInTheDocument());
    expect(screen.getByText(/16th US President/i)).toBeInTheDocument();
  });

  it('clicking a suggestion fetches wiki-lookup for that title', async () => {
    vi.useRealTimers();
    runDomain.mockImplementation(async (_d, action) => {
      if (action === 'wiki-search') {
        return { data: { ok: true, result: { ok: true, result: { results: [{ title: 'Abraham Lincoln', description: '16th US President', url: 'https://en.wikipedia.org/wiki/Abraham_Lincoln' }] } } } };
      }
      if (action === 'wiki-lookup') {
        return { data: { ok: true, result: { ok: true, result: {
          title: 'Abraham Lincoln',
          description: '16th president of the United States',
          extract: 'Abraham Lincoln was an American lawyer, politician, and statesman who served as the 16th president of the United States from 1861 until his assassination in 1865.',
          thumbnail: 'https://upload.wikimedia.org/lincoln.jpg',
          pageUrl: 'https://en.wikipedia.org/wiki/Abraham_Lincoln',
          lang: 'en',
          type: 'standard',
          source: 'wikipedia-rest',
        } } } };
      }
      return { data: { ok: false } };
    });
    renderWithQuery(<WikipediaExplorer />);
    fireEvent.change(screen.getByPlaceholderText(/Lincoln/i), { target: { value: 'lincoln' } });
    // Wait for the debounced search
    await waitFor(() => expect(runDomain).toHaveBeenCalled(), { timeout: 1000 });
    const sugg = await screen.findByText('Abraham Lincoln');
    // mousedown triggers selection
    fireEvent.mouseDown(sugg);
    await waitFor(() => {
      const c = runDomain.mock.calls.find((x) => x[1] === 'wiki-lookup');
      expect((c?.[2] as { input?: { title?: string } })?.input?.title).toBe('Abraham Lincoln');
    });
    await waitFor(() => expect(screen.getAllByText(/16th president of the United States/).length).toBeGreaterThanOrEqual(1));
    expect(screen.getByRole('link', { name: /Read on Wikipedia/i })).toBeInTheDocument();
  });

  it('switches to On-This-Day mode and fetches with month + day + kind', async () => {
    vi.useRealTimers();
    runDomain.mockResolvedValue({ data: { ok: true, result: { ok: true, result: {
      events: [{ text: 'Apollo 11 lands on the Moon', year: 1969, pages: [{ title: 'Apollo 11', extract: 'First crewed Moon landing', url: 'https://en.wikipedia.org/wiki/Apollo_11' }] }],
    } } } });
    renderWithQuery(<WikipediaExplorer />);
    fireEvent.click(screen.getByRole('button', { name: /On This Day/i }));
    await waitFor(() => expect(runDomain).toHaveBeenCalled());
    const call = runDomain.mock.calls[0];
    expect(call[0]).toBe('history');
    expect(call[1]).toBe('on-this-day');
    const input = (call[2] as { input?: { month?: number; day?: number; kind?: string } }).input;
    expect(typeof input?.month).toBe('number');
    expect(typeof input?.day).toBe('number');
    expect(input?.kind).toBe('events');
    await waitFor(() => expect(screen.getByText('Apollo 11 lands on the Moon')).toBeInTheDocument());
    expect(screen.getByText('1969')).toBeInTheDocument();
  });

  it('On-This-Day tab toggles refetch by kind', async () => {
    vi.useRealTimers();
    runDomain.mockResolvedValue({ data: { ok: true, result: { ok: true, result: { births: [{ text: 'Person X', year: 1900, pages: [] }] } } } });
    renderWithQuery(<WikipediaExplorer />);
    fireEvent.click(screen.getByRole('button', { name: /On This Day/i }));
    await waitFor(() => expect(runDomain).toHaveBeenCalled());
    runDomain.mockClear();
    fireEvent.click(screen.getByRole('button', { name: /^Births$/ }));
    await waitFor(() => {
      const c = runDomain.mock.calls.find((x) => (x[2] as { input?: { kind?: string } })?.input?.kind === 'births');
      expect(c).toBeTruthy();
    });
  });
});
