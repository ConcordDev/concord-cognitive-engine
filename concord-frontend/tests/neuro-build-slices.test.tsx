// @vitest-environment jsdom
/**
 * Neuro build slices — behaviour pins (S1 · S3 · S4).
 *
 * S1 (F2): the Statistics form's shipped example groups stand AS
 * VALUES (they were placeholder text over empty fields), and an
 * empty-form error does NOT latch the Run button (the early return
 * used to sit before the try/finally that clears busy).
 * S4 (F7): the shared literature panels consume the handler result
 * lensRun unwraps at data.result — papers/articles/results render,
 * where reading the fields off the envelope rendered every
 * successful fetch as empty.
 * S3 (F4): the bench mint receipt shows the FULL DTU id and the
 * synthetic: true stamp the banner promises (the create itself
 * already writes meta.synthetic: true — pinned here too).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const STAT_RESULT = {
  test: "Welch's t-test", groupA: { n: 4, mean: 1.175, sd: 0.25 }, groupB: { n: 4, mean: 0.45, sd: 0.129 },
  tStatistic: 5.1534, degreesOfFreedom: 4.49, pValue: 0.004882, cohensD: 3.644,
  effectSize: 'large', meanDifference: 0.725, significant: true, significance: 'Significant (p < 0.05)',
};
const PAPER = { arxivId: '2510.00001', title: 'Neural oscillations in working memory', summary: 'We show…', published: '2025-10-29', updated: '2025-10-29', authors: ['A. Researcher'], abstractUrl: 'https://arxiv.org/abs/2510.00001', pdfUrl: 'https://arxiv.org/pdf/2510.00001' };
const ARTICLE = { pmid: '39123456', title: 'Brain plasticity after stroke', journal: 'Neuroscience', pubdate: '2025 Oct', authors: ['B. Scientist'], doi: null, pubmedUrl: 'https://pubmed.ncbi.nlm.nih.gov/39123456/' };
const WIKI = { title: 'Neuroplasticity', description: 'brain property', extract: 'Neuroplasticity is…', thumbnail: null, url: 'https://en.wikipedia.org/wiki/Neuroplasticity', type: 'standard', lang: 'en' };
const MINT_ID = 'dtu_07bbfullid1234567890abcdef';

const lensRunCalls: { action: string; input: Record<string, unknown> }[] = [];
const postCalls: { url: string; body: Record<string, unknown> }[] = [];

vi.mock('@/lib/api/client', () => ({
  lensRun: async (a: unknown, b?: string, c?: Record<string, unknown>) => {
    const spec = (typeof a === 'string' ? { domain: a, action: b, input: c } : a) as { action?: string; name?: string; input?: Record<string, unknown> };
    const action = spec.action || spec.name || '';
    const input = spec.input || {};
    lensRunCalls.push({ action, input });
    if (action === 'listRecordings') return { data: { ok: true, result: { ok: true, recordings: [], count: 0 }, error: null } };
    if (action === 'statisticalTest') return { data: { ok: true, result: STAT_RESULT, error: null } };
    if (action === 'live_arxiv') return { data: { ok: true, result: { ok: true, source: 'arXiv', category: 'q-bio.NC', fetchedAt: 1761800000, total: 1, papers: [PAPER] }, error: null } };
    if (action === 'live_pubmed_neuro') return { data: { ok: true, result: { ok: true, source: 'PubMed (NCBI)', fetchedAt: 1761800000, total: 1, articles: [ARTICLE] }, error: null } };
    if (action === 'live_wiki_search') return { data: { ok: true, result: { ok: true, source: 'Wikipedia', fetchedAt: 1761800000, total: 1, results: [WIKI] }, error: null } };
    return { data: { ok: true, result: { ok: true }, error: null } };
  },
  api: {
    post: async (url: string, body: Record<string, unknown>) => {
      postCalls.push({ url, body });
      return { data: { result: { dtu: { id: MINT_ID } } } };
    },
  },
  apiHelpers: { lens: { runDomain: async () => ({ data: { ok: true, result: { ok: true, result: {} } } }) } },
}));

import { EegWorkbench } from '@/components/neuro/EegWorkbench';
import { NeuroActionPanel } from '@/components/neuro/NeuroActionPanel';
import { ArxivPanel } from '@/components/research/ArxivPanel';
import { PubMedPanel } from '@/components/research/PubMedPanel';
import { WikipediaSearchPanel } from '@/components/wiki/WikipediaSearchPanel';

beforeEach(() => { lensRunCalls.length = 0; postCalls.length = 0; });

describe('S1 — Statistics form (F2)', () => {
  it('ships the example groups AS VALUES and runs on first click', async () => {
    render(<EegWorkbench />);
    fireEvent.click(await screen.findByRole('button', { name: /Statistics/ }));
    const a = screen.getByDisplayValue('1.2, 0.9, 1.5, 1.1') as HTMLTextAreaElement;
    const b = screen.getByDisplayValue('0.4, 0.6, 0.3, 0.5') as HTMLTextAreaElement;
    expect(a.value).toBe('1.2, 0.9, 1.5, 1.1');
    expect(b.value).toBe('0.4, 0.6, 0.3, 0.5');
    fireEvent.click(screen.getByRole('button', { name: /Run t-test/ }));
    await waitFor(() => expect(screen.getByText(/t = 5\.1534/)).toBeTruthy());
    const call = lensRunCalls.find((x) => x.action === 'statisticalTest');
    expect(call?.input).toEqual({ groupA: [1.2, 0.9, 1.5, 1.1], groupB: [0.4, 0.6, 0.3, 0.5] });
  });

  it('an empty-form error does NOT latch the Run button', async () => {
    render(<EegWorkbench />);
    fireEvent.click(await screen.findByRole('button', { name: /Statistics/ }));
    const a = screen.getByDisplayValue('1.2, 0.9, 1.5, 1.1');
    fireEvent.change(a, { target: { value: '' } });
    const run = screen.getByRole('button', { name: /Run t-test/ }) as HTMLButtonElement;
    fireEvent.click(run);
    await waitFor(() => expect(screen.getByText(/Each group needs at least 2 numeric values/)).toBeTruthy());
    expect(run.disabled).toBe(false);
    // and the tool still works afterwards — no reload needed
    fireEvent.change(a, { target: { value: '2.1, 2.4, 2.2' } });
    fireEvent.click(run);
    await waitFor(() => expect(screen.getByText(/t = 5\.1534/)).toBeTruthy());
  });
});

describe('S4 — literature panels read the unwrapped result (F7)', () => {
  it('arXiv panel renders papers from a successful fetch', async () => {
    render(<ArxivPanel domain="neuro" title="arXiv · Neuroscience (q-bio.NC)" />);
    await waitFor(() => expect(screen.getByText('Neural oscillations in working memory')).toBeTruthy());
    expect(screen.queryByText(/No papers returned/)).toBeNull();
  });

  it('PubMed panel renders articles for the shipped query', async () => {
    render(<PubMedPanel domain="neuro" macro="live_pubmed_neuro" title="PubMed · neuroscience" initialQuery="brain plasticity" />);
    await waitFor(() => expect(screen.getByText('Brain plasticity after stroke')).toBeTruthy());
    expect(screen.queryByText(/No PubMed articles/)).toBeNull();
  });

  it('Wikipedia panel renders results for a real topic', async () => {
    render(<WikipediaSearchPanel domain="neuro" title="Wikipedia · neuroscience" />);
    const input = screen.getByPlaceholderText(/Search Wikipedia/) as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'neuroplasticity' } });
    await waitFor(() => expect(screen.getByText('Neuroplasticity')).toBeTruthy(), { timeout: 3000 });
    expect(screen.queryByText(/No Wikipedia matches/)).toBeNull();
  });
});

describe('S3 — bench mint receipt (F4)', () => {
  it('the receipt shows the full DTU id and the synthetic stamp; the create writes meta.synthetic', async () => {
    render(<NeuroActionPanel />);
    fireEvent.click(await screen.findByRole('button', { name: /Mint/ }));
    await waitFor(() => expect(screen.getByText(new RegExp(`${MINT_ID} · synthetic: true`))).toBeTruthy());
    expect(screen.queryByText(/dtu_07bb…/)).toBeNull();
    const create = postCalls.find((x) => (x.body as { name?: string }).name === 'create');
    const input = (create?.body as { input?: { meta?: { synthetic?: boolean } } }).input;
    expect(input?.meta?.synthetic).toBe(true);
  });
});
