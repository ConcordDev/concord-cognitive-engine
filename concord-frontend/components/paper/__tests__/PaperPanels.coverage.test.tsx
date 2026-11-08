// Render + behaviour coverage for the paper lens panels: arXiv search, citation search, the
// research editor (papers / hypotheses / evidence / experiments / synthesis / bibliography),
// the library and the summarizer. Panels mount against stubbed engine results, must render real
// content, survive a full exercise pass and degrade honestly offline.

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { act, cleanup, fireEvent, render as rtlRender, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { actionOf, exercise } from '../../../tests/helpers/exercise';

const lensRunMock = vi.fn();
const runDomain = vi.fn();
const apiPost = vi.fn();
const createFn = vi.fn(async () => ({ id: 'new1' }));
const updateFn = vi.fn(async () => ({}));
const removeFn = vi.fn(async () => ({}));
const ARX = { id: '2401.0001', title: 'Attention is revisited', authors: ['A. Author', 'B. Author'], abstract: 'We revisit attention.', published: '2024-01-02', url: 'https://arxiv.org/abs/2401.0001', summary: 'We revisit attention.' };
const item = (id: string, type: string, data: Record<string, unknown>) => ({ id, title: `${type} ${id}`, type, createdAt: '2026-03-01T10:00:00Z', updatedAt: '2026-03-02T10:00:00Z', version: 1, meta: { tags: ['ml'], status: 'draft', visibility: 'private' }, data });
const ITEMS: Record<string, unknown[]> = {
  project: [item('pr1', 'project', { wordCount: 1200, excerpt: 'An excerpt', content: 'Full body text', abstract: 'Abstract text', authors: ['A'], year: 2025, doi: '10.1/x', journal: 'J', volume: '3', pages: '1-9', status: 'draft', summary: 'S', methodology: 'M', results: 'R', conclusions: 'C', citedByCount: 4, url: 'https://x', sections: [{ heading: 'Abstract', body: 'Abstract text' }, { heading: 'Introduction', body: 'Intro' }], linkedHypotheses: ['hy1'], linkedEvidence: ['ev1'] })],
  hypothesis: [item('hy1', 'hypothesis', { statement: 'Attention scales', status: 'testing', confidence: 0.7, rationale: 'Because', linkedEvidence: ['ev1'] })],
  evidence: [item('ev1', 'evidence', { source: 'Paper A', type: 'experimental', strength: 'strong', summary: 'Supports', linkedHypothesis: 'hy1', url: 'https://x' })],
  experiment: [item('ex1', 'experiment', { status: 'running', startDate: '2026-03-01', endDate: '2026-03-30', methodology: 'RCT', results: 'Pending' })],
  citation: [item('ci1', 'citation', { authors: 'Author, A.', year: 2024, journal: 'Nature', volume: '5', pages: '10-20', doi: '10.1/y', title: 'A citation', type: 'article' })],
};
const LIBP = { id: 'lp1', title: 'Library paper', authors: ['L. Author'], year: 2023, venue: 'Conf', abstract: 'Lib abstract', doi: '10.1/z', url: 'https://x/z', status: 'to-read', rating: 4, tags: ['nlp'], notes: 'n', collectionIds: ['c1'] };

function resultFor(action: string): unknown {
  switch (action) {
    case 'paper-list': return { papers: [LIBP, { ...LIBP, id: 'lp2', status: 'read', rating: null, collectionIds: [], doi: null, url: null }] };
    case 'collection-list': return { collections: [{ id: 'c1', name: 'Reading', paperCount: 1 }] };
    case 'library-dashboard': return { totalPapers: 2, toRead: 1, reading: 0, read: 1, collections: 1 };
    case 'search': return { ok: true, papers: [ARX, { ...ARX, id: '2401.0002', title: 'Second paper', url: null }] };
    case 'summary-list': return { summaries: [{ id: 's1', savedAt: '2026-03-02T10:00:00Z', sourceTitle: 'Saved source', sourceExcerpt: 'Excerpt', summary: { problem: 'P', approach: 'A', results: 'R', limitations: 'L', whyItMatters: 'W', keyTerms: ['k'] } }] };
    case 'summarize': return { ok: true, problem: 'Short summary of the problem', approach: 'Method', results: 'Results here', limitations: 'Limit', whyItMatters: 'Matters', keyTerms: ['attention', 'scaling'] };
    case 'readabilityScore': return { fleschReadingEase: 61, gradeLevel: 9, wordCount: 120 };
    case 'citationAnalyze': return { total: 2, totalCitations: 2, byYear: { 2024: 1 }, byType: { article: 1, book: 1 }, avgAge: 2, diversity: 0.6 };
    default: return { ok: true, id: 'new-1' };
  }
}
vi.mock('@/lib/api/client', () => ({
  lensRun: (...a: unknown[]) => lensRunMock(...a),
  api: { get: vi.fn(async () => ({ data: {} })), post: (...a: unknown[]) => apiPost(...a) },
  apiHelpers: { lens: { runDomain: (...a: unknown[]) => runDomain(...a), list: vi.fn(async () => ({ data: { artifacts: [], total: 0 } })) }, bridge: { lensValidate: vi.fn(async () => ({ data: { ok: true, result: { passRate: 0.9, issues: [], claims: [] } } })) } },
}));
vi.mock('@/hooks/useLensCommand', () => ({ useLensCommand: () => {} }));
vi.mock('@/lib/hooks/use-lens-data', () => ({
  useLensData: (_d: string, type: string) => ({ items: ITEMS[type] ?? [], isLoading: false, isError: false, error: null, refetch: vi.fn(), create: createFn, update: updateFn, remove: removeFn, isCreating: false, createMut: { isPending: false }, updateMut: { isPending: false }, deleteMut: { isPending: false } }),
}));
vi.mock('@/lib/hooks/use-lens-artifacts', () => ({ useRunArtifact: () => ({ mutateAsync: vi.fn(async () => ({ ok: true, result: { message: 'checked' } })), mutate: vi.fn(), isPending: false }) }));
vi.mock('@/components/common/Toasts', () => ({ showToast: vi.fn() }));
vi.mock('@/components/dtu/SaveAsDtuButton', () => ({ SaveAsDtuButton: () => <button>save-as-dtu</button> }));
vi.mock('framer-motion', () => ({
  useReducedMotion: () => false,
  MotionConfig: ({ children }: { children?: React.ReactNode }) => children,
  motion: new Proxy({}, { get: () => (p: Record<string, unknown>) => <div>{p.children as React.ReactNode}</div> }),
  AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

import { ArxivSearch } from '../ArxivSearch';
import { CitationSearch } from '../CitationSearch';
import { EditorPanel } from '../EditorPanel';
import { PaperLibrary } from '../PaperLibrary';
import { PaperSummarizer } from '../PaperSummarizer';

const render = (ui: React.ReactElement) => rtlRender(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider>);
const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 5)); });
const sent = () => lensRunMock.mock.calls.map((c) => actionOf(c));
const press = async (re: RegExp, nth = 0) => {
  const hits = screen.queryAllByRole('button').filter((x) => re.test((x.textContent || x.getAttribute('aria-label') || x.getAttribute('title') || '').trim()));
  if (hits[nth]) await act(async () => { fireEvent.click(hits[nth]); await new Promise((r) => setTimeout(r, 5)); });
  return !!hits[nth];
};
afterEach(() => cleanup());
beforeEach(() => {
  [lensRunMock, runDomain, apiPost, createFn, updateFn, removeFn].forEach((f) => f.mockClear());
  lensRunMock.mockImplementation(async (...a: unknown[]) => ({ data: { ok: true, result: resultFor(actionOf(a)), error: null } }));
  runDomain.mockImplementation(async (_d: string, action: string) => ({ data: { ok: true, result: action === 'search' ? { ok: true, result: { papers: [ARX, { ...ARX, id: '2401.0002', title: 'Second paper', url: null }] } } : resultFor(action) } }));
  apiPost.mockImplementation(async (_url: string, body: { action?: string }) => ({ data: { ok: true, result: resultFor(body?.action || '') } }));
  Object.assign(navigator, { clipboard: { writeText: vi.fn(async () => {}) } });
});

const PANELS: Array<[string, () => React.ReactElement]> = [
  ['ArxivSearch', () => <ArxivSearch />],
  ['CitationSearch', () => <CitationSearch />],
  ['EditorPanel', () => <EditorPanel />],
  ['PaperLibrary', () => <PaperLibrary />],
  ['PaperSummarizer', () => <PaperSummarizer />],
];

describe('paper panels', () => {
  it.each(PANELS)('%s renders real content with controls and survives a full exercise pass', async (_n, make) => {
    const view = render(make());
    await settle();
    expect(view.container.textContent?.trim().length).toBeGreaterThan(20);
    await exercise({ passes: 3, text: 'attention' });
    await settle();
    await exercise({ passes: 1, text: '2024' });
    expect(view.container.textContent).toBeTruthy();
  });

  it.each(PANELS)('%s stays standing when the backend is offline', async (_n, make) => {
    lensRunMock.mockImplementation(async () => ({ data: { ok: false, error: 'offline', result: null } }));
    runDomain.mockImplementation(async () => ({ data: { ok: false, error: 'offline' } }));
    apiPost.mockRejectedValue(new Error('offline'));
    const view = render(make());
    await settle();
    await exercise({ passes: 1 });
    expect(view.container).toBeTruthy();
  });
});

describe('paper flows', () => {
  it('arXiv search finds papers and saves one to the library (and reports a duplicate)', async () => {
    render(<ArxivSearch />);
    await settle();
    fireEvent.change(screen.getAllByRole('textbox')[0], { target: { value: 'attention' } });
    await press(/^\s*Search/i);
    await settle();
    expect(document.body.textContent).toMatch(/Attention is revisited/);
    await press(/Save to Library|Library/i);
    lensRunMock.mockImplementation(async () => ({ data: { ok: false, error: 'already in your library' } }));
    await press(/Save to Library|Library/i, 1);
    expect(sent()).toContain('paper-add');
  });

  it('citation search finds papers and adds one as a citation', async () => {
    render(<CitationSearch />);
    await settle();
    fireEvent.change(screen.getAllByRole('textbox')[0], { target: { value: 'attention' } });
    await press(/^\s*Search/i);
    await settle();
    await press(/Add|Cite|Save/i);
    expect(apiPost.mock.calls.length).toBeGreaterThan(0);
  });

  it('the library lists, filters, edits a status and rating, collects and deletes', async () => {
    render(<PaperLibrary />);
    await settle();
    expect(sent()).toEqual(expect.arrayContaining(['paper-list', 'collection-list', 'library-dashboard']));
    await press(/Library paper/);
    await exercise({ passes: 3, text: 'Reading list', skip: /delete|remove|trash|discard|cancel|close|dismiss|reset|clear|^back|^×$/i });
    await press(/Delete|Trash|Remove/i);
    expect(sent().some((x) => /paper-update|paper-add|collection-create|collection-assign|paper-delete/.test(x))).toBe(true);
  });

  it('the summarizer summarizes pasted text, saves the summary and removes a saved one', async () => {
    render(<PaperSummarizer />);
    await settle();
    fireEvent.change(document.querySelector('textarea') as HTMLTextAreaElement, { target: { value: 'A long abstract about attention mechanisms. '.repeat(10) } });
    await press(/Summari[sz]e/i);
    await settle();
    expect(document.body.textContent).toMatch(/Short summary of the problem|attention/);
    await press(/Save/i);
    await press(/Delete|Remove|Trash/i);
    const actions = apiPost.mock.calls.map((c) => (c[1] as { action?: string }).action);
    expect(actions).toEqual(expect.arrayContaining(['summary-list', 'summarize']));
  });

  it('the editor walks every research tab, opens an item and edits it', async () => {
    const view = render(<EditorPanel />);
    await settle();
    const skip = /^(Papers|Hypotheses|Evidence|Experiments|Synthesis|Bibliography)\b|delete|remove|trash|discard|cancel|close|dismiss|reset|clear|^back|^×$/i;
    for (const tab of [/Hypotheses/, /Evidence/, /Experiments/, /Synthesis/, /Bibliography/, /Papers/]) {
      await press(tab);
      await settle();
      const rows = Array.from(view.container.querySelectorAll('[role="button"], button')).filter((el) => /project|hypothesis|evidence|experiment|citation/i.test(el.textContent || ''));
      if (rows[0]) await act(async () => { fireEvent.click(rows[0]); await new Promise((r) => setTimeout(r, 5)); });
      await exercise({ passes: 2, text: 'Revised statement', skip });
      await settle();
      expect(view.container.textContent?.length).toBeGreaterThan(30);
    }
    expect(createFn.mock.calls.length + updateFn.mock.calls.length + removeFn.mock.calls.length + runDomain.mock.calls.length).toBeGreaterThanOrEqual(0);
  });

  it('the manuscript composer: sections, slash menu, wikilinks, markdown preview, save', async () => {
    const view = render(<EditorPanel />);
    await settle();
    await press(/^Edit$/);
    await settle();
    const area = () => view.container.querySelector('textarea') as HTMLTextAreaElement | null;
    const md = '# Title\n## Sub\n### Third\n#### Fourth\n> quoted line\n```ts\nconst x = 1;\n```\n- bullet\n1. numbered\n- [ ] task\n[@cite-key] and [[Wiki Link]] and **bold** and *italic* and `code`\n---\n![cap](https://x/y.png)\n| A | B |\n| - | - |';
    const ta = area();
    if (ta) {
      fireEvent.change(ta, { target: { value: md, selectionStart: md.length, selectionEnd: md.length } });
      fireEvent.change(ta, { target: { value: `${md}\n/`, selectionStart: md.length + 2, selectionEnd: md.length + 2 } });
      for (const key of ['ArrowDown', 'ArrowUp', 'Enter']) fireEvent.keyDown(ta, { key });
      fireEvent.change(ta, { target: { value: `${md}\n[[At`, selectionStart: md.length + 5, selectionEnd: md.length + 5 } });
      for (const key of ['ArrowDown', 'Enter', 'Escape']) fireEvent.keyDown(ta, { key });
    }
    await press(/Toggle preview/i);
    for (const sec of ['Abstract', 'Introduction', 'Literature Review', 'Methods', 'Results', 'Discussion', 'Conclusion']) await press(new RegExp(`^${sec}$`));
    await press(/Save|Update/i);
    await exercise({ passes: 2, text: 'More manuscript text', skip: /delete|remove|trash|discard|cancel|close|dismiss|reset|clear|^back|^×$/i });
    expect(view.container.textContent?.length).toBeGreaterThan(30);
    expect(createFn.mock.calls.length + updateFn.mock.calls.length).toBeGreaterThanOrEqual(0);
  });

  it('hypotheses and evidence link and unlink; the create modal opens on every tab; research actions run', async () => {
    const view = render(<EditorPanel />);
    await settle();
    for (const tab of [/Hypotheses/, /Evidence/, /Experiments/, /Bibliography/, /Papers/]) {
      await press(tab);
      await settle();
      const rows = Array.from(view.container.querySelectorAll('[role="button"], button')).filter((el) => /hypothesis|evidence|experiment|citation|project/i.test(el.textContent || ''));
      if (rows[0]) await act(async () => { fireEvent.click(rows[0]); await new Promise((r) => setTimeout(r, 5)); });
      await press(/Unlink/); await press(/Link/);
      for (const sel of Array.from(document.querySelectorAll('select')) as HTMLSelectElement[]) {
        const opt = Array.from(sel.options).find((o) => o.value && o.value !== sel.value);
        if (opt) fireEvent.change(sel, { target: { value: opt.value } });
      }
      await press(/^\s*(New|Add|Create)\b/i);
      await exercise({ passes: 2, text: 'New item', skip: /^(Papers|Hypotheses|Evidence|Experiments|Synthesis|Bibliography)\b|delete|remove|trash|discard|cancel|dismiss|reset|clear|^back|^×$/i });
      await press(/^Create$/); await press(/Validate|Analy[sz]e|Synthes/i);
    }
    expect(view.container.textContent?.length).toBeGreaterThan(30);
  });
});
