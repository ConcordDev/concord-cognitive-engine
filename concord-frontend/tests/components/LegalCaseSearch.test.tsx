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

vi.mock('@/store/ui', () => ({
  useUIStore: (sel: (s: unknown) => unknown) => sel({ addToast }),
}));

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

import { LegalCaseSearch } from '@/components/legal/LegalCaseSearch';

function renderWithQuery(node: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{node}</QueryClientProvider>);
}

const MOCK_HIT = {
  id: 108713,
  caseName: 'Brown v. Board of Education',
  court: 'Supreme Court of the United States',
  courtId: 'scotus',
  dateFiled: '1954-05-17',
  absoluteUrl: 'https://www.courtlistener.com/opinion/108713/brown-v-board-of-education/',
  snippet: 'In the field of public education, the doctrine of "separate but equal" has no place.',
  citation: ['347 U.S. 483', '74 S. Ct. 686'],
  precedentialStatus: 'Published',
  docketNumber: '1',
  judges: 'Warren',
  author: 'Warren',
};

describe('LegalCaseSearch', () => {
  beforeEach(() => {
    runDomain.mockReset();
    addToast.mockReset();
    create.mockReset();
  });

  it('renders empty state with key-token hint', () => {
    renderWithQuery(<LegalCaseSearch />);
    expect(screen.getByPlaceholderText(/Brown v\. Board/)).toBeInTheDocument();
    expect(screen.getByText(/COURTLISTENER_API_TOKEN/)).toBeInTheDocument();
  });

  it('posts query + parses hit list with case-name, citations, snippet', async () => {
    runDomain.mockResolvedValue({ data: { ok: true, result: { ok: true, result: {
      query: 'brown v board',
      results: [MOCK_HIT],
      count: 1, totalHits: 47, authenticatedWithToken: false, source: 'courtlistener',
    } } } });
    renderWithQuery(<LegalCaseSearch />);
    fireEvent.change(screen.getByPlaceholderText(/Brown v\. Board/), { target: { value: 'brown v board' } });
    fireEvent.click(screen.getByRole('button', { name: /^Search$/ }));

    await waitFor(() => expect(screen.getByText('Brown v. Board of Education')).toBeInTheDocument());
    expect(screen.getByText('347 U.S. 483')).toBeInTheDocument();
    expect(screen.getByText('Supreme Court of the United States')).toBeInTheDocument();
    expect(screen.getByText('1954-05-17')).toBeInTheDocument();
    // precedential status pill
    expect(screen.getByText('Published')).toBeInTheDocument();
    // 1 of 47 shown
    expect(screen.getByText(/1 of 47 hits/)).toBeInTheDocument();
    // Macro shape
    const call = runDomain.mock.calls[0];
    expect(call[0]).toBe('law');
    expect(call[1]).toBe('courtlistener-search');
    expect((call[2] as { input?: { query?: string } })?.input?.query).toBe('brown v board');
  });

  it('passes court + date filters when set in the filters drawer', async () => {
    runDomain.mockResolvedValue({ data: { ok: true, result: { ok: true, result: {
      query: 'qualified immunity', results: [], count: 0, totalHits: 0,
      authenticatedWithToken: true, source: 'courtlistener',
    } } } });
    renderWithQuery(<LegalCaseSearch />);
    fireEvent.click(screen.getByRole('button', { name: /Filters/i }));
    fireEvent.click(await screen.findByRole('button', { name: 'Supreme Court' }));
    fireEvent.change(screen.getByPlaceholderText(/Brown v\. Board/), { target: { value: 'qualified immunity' } });
    fireEvent.click(screen.getByRole('button', { name: /^Search$/ }));
    await waitFor(() => expect(runDomain).toHaveBeenCalled());
    const input = (runDomain.mock.calls[0][2] as { input?: Record<string, unknown> }).input;
    expect(input?.court).toBe('scotus');
    expect(input?.query).toBe('qualified immunity');
  });

  it('toggles Clip-to-Folder bookmark per-card', async () => {
    runDomain.mockResolvedValue({ data: { ok: true, result: { ok: true, result: {
      query: 'x', results: [MOCK_HIT], count: 1, totalHits: 1, authenticatedWithToken: false, source: 'courtlistener',
    } } } });
    renderWithQuery(<LegalCaseSearch />);
    fireEvent.change(screen.getByPlaceholderText(/Brown v\. Board/), { target: { value: 'x' } });
    fireEvent.click(screen.getByRole('button', { name: /^Search$/ }));
    await waitFor(() => expect(screen.getByText('Brown v. Board of Education')).toBeInTheDocument());
    const clip = screen.getByLabelText('Clip to folder');
    fireEvent.click(clip);
    expect(screen.getByLabelText('Unclip')).toBeInTheDocument();
  });

  it('highlights query terms in the snippet', async () => {
    runDomain.mockResolvedValue({ data: { ok: true, result: { ok: true, result: {
      query: 'separate equal',
      results: [MOCK_HIT], count: 1, totalHits: 1, authenticatedWithToken: false, source: 'courtlistener',
    } } } });
    renderWithQuery(<LegalCaseSearch />);
    fireEvent.change(screen.getByPlaceholderText(/Brown v\. Board/), { target: { value: 'separate equal' } });
    fireEvent.click(screen.getByRole('button', { name: /^Search$/ }));
    await waitFor(() => expect(screen.getByText('Brown v. Board of Education')).toBeInTheDocument());
    // The literal mark wraps the matched term
    const marks = document.querySelectorAll('mark');
    expect(marks.length).toBeGreaterThanOrEqual(2);
    expect(Array.from(marks).some((m) => /separate/i.test(m.textContent || ''))).toBe(true);
    expect(Array.from(marks).some((m) => /equal/i.test(m.textContent || ''))).toBe(true);
  });

  it('renders empty-state for 0 hits + suggests broader terms', async () => {
    runDomain.mockResolvedValue({ data: { ok: true, result: { ok: true, result: {
      query: 'zxc', results: [], count: 0, totalHits: 0, authenticatedWithToken: false, source: 'courtlistener',
    } } } });
    renderWithQuery(<LegalCaseSearch />);
    fireEvent.change(screen.getByPlaceholderText(/Brown v\. Board/), { target: { value: 'zxc' } });
    fireEvent.click(screen.getByRole('button', { name: /^Search$/ }));
    await waitFor(() => expect(screen.getByText(/No opinions match/i)).toBeInTheDocument());
  });

  it('surfaces 429 rate-limit error', async () => {
    runDomain.mockResolvedValue({ data: { ok: true, result: { ok: false,
      error: 'courtlistener rate limit — set COURTLISTENER_API_TOKEN env',
    } } });
    renderWithQuery(<LegalCaseSearch />);
    fireEvent.change(screen.getByPlaceholderText(/Brown v\. Board/), { target: { value: 'x' } });
    fireEvent.click(screen.getByRole('button', { name: /^Search$/ }));
    await waitFor(() => expect(screen.getAllByText(/COURTLISTENER_API_TOKEN/).length).toBeGreaterThanOrEqual(1));
  });
});
