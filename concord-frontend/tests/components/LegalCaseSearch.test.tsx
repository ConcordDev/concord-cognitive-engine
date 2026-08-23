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

  describe('Citing opinions panel (law.citation-graph)', () => {
    async function renderWithOneHit() {
      runDomain.mockResolvedValueOnce({ data: { ok: true, result: { ok: true, result: {
        query: 'x', results: [MOCK_HIT], count: 1, totalHits: 1, authenticatedWithToken: false, source: 'courtlistener',
      } } } });
      renderWithQuery(<LegalCaseSearch />);
      fireEvent.change(screen.getByPlaceholderText(/Brown v\. Board/), { target: { value: 'x' } });
      fireEvent.click(screen.getByRole('button', { name: /^Search$/ }));
      await waitFor(() => expect(screen.getByText('Brown v. Board of Education')).toBeInTheDocument());
    }

    it('is collapsed by default and does not call the macro until expanded', async () => {
      await renderWithOneHit();
      expect(runDomain).toHaveBeenCalledTimes(1); // only the search call so far
      expect(screen.getByRole('button', { name: /Citing opinions/i })).toHaveAttribute('aria-expanded', 'false');
    });

    it('shows a loading state, then the real populated citation network diagram (both directions)', async () => {
      await renderWithOneHit();
      let resolveCitedBy: (v: unknown) => void = () => {};
      let resolveCites: (v: unknown) => void = () => {};
      // The panel fetches BOTH directions on open — citedBy first, then
      // cites (mount-order in the component's useEffect).
      runDomain.mockReturnValueOnce(new Promise((res) => { resolveCitedBy = res; }));
      runDomain.mockReturnValueOnce(new Promise((res) => { resolveCites = res; }));

      fireEvent.click(screen.getByRole('button', { name: /Citing opinions/i }));
      // "Loading citation network" is an aria-label on the skeleton container,
      // not rendered text — query it via its accessible name.
      await waitFor(() => expect(screen.getByLabelText(/Loading citation network/i)).toBeInTheDocument());

      resolveCitedBy({ data: { ok: true, result: { ok: true, result: {
        opinionId: MOCK_HIT.id, direction: 'citedBy',
        citations: [
          { id: 1, citingOpinionId: 10008139, citingOpinionUrl: 'https://www.courtlistener.com/api/rest/v4/opinions/10008139/', citedOpinionId: MOCK_HIT.id, citedOpinionUrl: null, otherOpinionId: 10008139, depth: 4 },
          { id: 2, citingOpinionId: 9000001, citingOpinionUrl: 'https://www.courtlistener.com/api/rest/v4/opinions/9000001/', citedOpinionId: MOCK_HIT.id, citedOpinionUrl: null, otherOpinionId: 9000001, depth: 1 },
        ],
        count: 2, totalHits: 2, authenticatedWithToken: false, source: 'courtlistener',
      } } } });
      resolveCites({ data: { ok: true, result: { ok: true, result: {
        opinionId: MOCK_HIT.id, direction: 'cites',
        citations: [
          { id: 3, citingOpinionId: MOCK_HIT.id, citingOpinionUrl: null, citedOpinionId: 500001, citedOpinionUrl: 'https://www.courtlistener.com/api/rest/v4/opinions/500001/', otherOpinionId: 500001, depth: 2 },
        ],
        count: 1, totalHits: 1, authenticatedWithToken: false, source: 'courtlistener',
      } } } });

      await waitFor(() => expect(screen.queryByLabelText(/Loading citation network/i)).not.toBeInTheDocument());
      // citedBy-side nodes (right column, "who cites this opinion")
      expect(screen.getByText('Opinion #10008139')).toBeInTheDocument();
      expect(screen.getByText('×4')).toBeInTheDocument();
      expect(screen.getByText('Opinion #9000001')).toBeInTheDocument();
      expect(screen.getByText('×1')).toBeInTheDocument();
      // cites-side node (left column, "what this opinion cites")
      expect(screen.getByText('Opinion #500001')).toBeInTheDocument();
      expect(screen.getByText('×2')).toBeInTheDocument();

      // Verifies both macro calls fired with the right direction.
      const calls = runDomain.mock.calls.slice(-2) as Array<[string, string, { input?: { opinionId?: number; direction?: string } }]>;
      expect(calls[0][0]).toBe('law');
      expect(calls[0][1]).toBe('citation-graph');
      expect(calls[0][2].input?.opinionId).toBe(MOCK_HIT.id);
      expect(calls[0][2].input?.direction).toBe('citedBy');
      expect(calls[1][2].input?.direction).toBe('cites');
    });

    it('shows an honest empty state when CourtListener has zero citations in both directions', async () => {
      await renderWithOneHit();
      const emptyResult = (direction: string) => ({ data: { ok: true, result: { ok: true, result: {
        opinionId: MOCK_HIT.id, direction, citations: [], count: 0, totalHits: 0,
        authenticatedWithToken: false, source: 'courtlistener',
      } } } });
      runDomain.mockResolvedValueOnce(emptyResult('citedBy'));
      runDomain.mockResolvedValueOnce(emptyResult('cites'));
      fireEvent.click(screen.getByRole('button', { name: /Citing opinions/i }));
      await waitFor(() => expect(screen.getByText(/No citation links found on CourtListener/i)).toBeInTheDocument());
    });

    it('shows an honest error state on a failed lookup — never a fabricated empty/zero result', async () => {
      await renderWithOneHit();
      runDomain.mockResolvedValueOnce({ data: { ok: true, result: { ok: false,
        error: 'courtlistener rate limit — set COURTLISTENER_API_TOKEN env',
      } } });
      runDomain.mockResolvedValueOnce({ data: { ok: true, result: { ok: true, result: {
        opinionId: MOCK_HIT.id, direction: 'cites', citations: [], count: 0, totalHits: 0,
        authenticatedWithToken: false, source: 'courtlistener',
      } } } });
      fireEvent.click(screen.getByRole('button', { name: /Citing opinions/i }));
      await waitFor(() => expect(screen.getByText(/COURTLISTENER_API_TOKEN/i)).toBeInTheDocument());
      expect(screen.queryByText(/No citation links found on CourtListener/i)).not.toBeInTheDocument();
    });
  });

  describe('semantic search toggle', () => {
    it('defaults to Keyword mode and omits `semantic` from the macro params', async () => {
      runDomain.mockResolvedValue({ data: { ok: true, result: { ok: true, result: {
        query: 'x', semantic: false, results: [], count: 0, totalHits: 0,
        authenticatedWithToken: false, source: 'courtlistener',
      } } } });
      renderWithQuery(<LegalCaseSearch />);
      expect(screen.getByRole('radio', { name: /Keyword/i })).toHaveAttribute('aria-checked', 'true');
      expect(screen.getByRole('radio', { name: /Semantic/i })).toHaveAttribute('aria-checked', 'false');

      fireEvent.change(screen.getByPlaceholderText(/Brown v\. Board/), { target: { value: 'x' } });
      fireEvent.click(screen.getByRole('button', { name: /^Search$/ }));
      await waitFor(() => expect(runDomain).toHaveBeenCalled());
      const input = (runDomain.mock.calls[0][2] as { input?: Record<string, unknown> }).input;
      expect(input).not.toHaveProperty('semantic');
    });

    it('clicking Semantic sends semantic:true and swaps the placeholder to a natural-language hint', async () => {
      runDomain.mockResolvedValue({ data: { ok: true, result: { ok: true, result: {
        query: 'excessive force during a routine stop', semantic: true,
        results: [{ ...MOCK_HIT, semanticScore: 0.87, bm25Score: 4.2 }],
        count: 1, totalHits: 1, authenticatedWithToken: false, source: 'courtlistener',
      } } } });
      renderWithQuery(<LegalCaseSearch />);

      fireEvent.click(screen.getByRole('radio', { name: /Semantic/i }));
      expect(screen.getByRole('radio', { name: /Semantic/i })).toHaveAttribute('aria-checked', 'true');
      expect(screen.getByRole('radio', { name: /Keyword/i })).toHaveAttribute('aria-checked', 'false');
      expect(screen.getByPlaceholderText(/Describe what you.re looking for/i)).toBeInTheDocument();

      fireEvent.change(
        screen.getByPlaceholderText(/Describe what you.re looking for/i),
        { target: { value: 'excessive force during a routine stop' } }
      );
      fireEvent.click(screen.getByRole('button', { name: /^Search$/ }));

      await waitFor(() => expect(runDomain).toHaveBeenCalled());
      const input = (runDomain.mock.calls[0][2] as { input?: Record<string, unknown> }).input;
      expect(input?.semantic).toBe(true);
      expect(input?.query).toBe('excessive force during a routine stop');

      // Result carries the real semantic-mode badge + per-hit relevance score.
      await waitFor(() => expect(screen.getByText('Brown v. Board of Education')).toBeInTheDocument());
      expect(screen.getByText(/·\s*semantic/)).toBeInTheDocument();
      // The score renders in a nested <span> ("87%") with " match" as a
      // sibling text node in the parent — a plain getByText regex against
      // the combined string never matches a single text node.
      expect(screen.getByText((_content, element) =>
        element?.tagName.toLowerCase() === 'span' &&
        element.textContent === '87% match'
      )).toBeInTheDocument();
    });

    it('does not render a match-score badge when the backend omits semanticScore (keyword results)', async () => {
      runDomain.mockResolvedValue({ data: { ok: true, result: { ok: true, result: {
        query: 'x', semantic: false, results: [MOCK_HIT], count: 1, totalHits: 1,
        authenticatedWithToken: false, source: 'courtlistener',
      } } } });
      renderWithQuery(<LegalCaseSearch />);
      fireEvent.change(screen.getByPlaceholderText(/Brown v\. Board/), { target: { value: 'x' } });
      fireEvent.click(screen.getByRole('button', { name: /^Search$/ }));
      await waitFor(() => expect(screen.getByText('Brown v. Board of Education')).toBeInTheDocument());
      // The score badge's own text is split across elements (see above), so
      // check for its unique wrapper via title rather than a text query that
      // could never match a single node either way.
      expect(screen.queryByTitle('CourtListener semantic relevance score')).not.toBeInTheDocument();
    });
  });
});
