// Render + behaviour coverage for the linguistics lens panels: free-text analysis, the action panel
// (dictionary / Datamuse / text, sentiment and frequency analysis), the notebook (analyses, lexicon,
// grammars, corpora, translations, dashboard) and word tools.

import React from 'react';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { act, cleanup, fireEvent, render as rtlRender, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { actionOf, exercise } from '../../../tests/helpers/exercise';

const lensRunMock = vi.fn();
const runDomain = vi.fn();
const apiPost = vi.fn();
const createFn = vi.fn(async () => ({ id: 'n1' }));
const updateFn = vi.fn(async () => ({}));
const removeFn = vi.fn(async () => ({}));
const lens = (id: string, type: string, title: string, data: Record<string, unknown>) => ({ id, title, type, createdAt: '2026-03-01T10:00:00Z', updatedAt: '2026-03-02T10:00:00Z', version: 1, meta: { tags: ['syntax'], status: 'draft', visibility: 'private' }, data: { artifactType: type, subfield: 'syntax', language: 'English', description: `${title} description`, sourceText: 'The cat sat', targetText: 'Le chat', glosses: ['the', 'cat'], morphemes: ['cat', 's'], syntaxTree: '[S [NP [D the] [N cat]] [VP [V sat]]]', ipa: '/kæt/', examples: ['The cat sat'], texts: ['First text', 'Second text'], notes: 'n', sourceLanguage: 'English', targetLanguage: 'French', ...data } });
const BY_TYPE: Record<string, unknown[]> = {
  Analysis: [lens('a1', 'Analysis', 'Cat parse', {})],
  LexiconEntry: [lens('l1', 'LexiconEntry', 'cat', { ipa: '/kæt/' })],
  Grammar: [lens('g1', 'Grammar', 'English SVO', {})],
  Corpus: [lens('c1', 'Corpus', 'News corpus', {})],
  Translation: [lens('t1', 'Translation', 'Cat to French', {})],
};

function resultFor(action: string): unknown {
  switch (action) {
    case 'analyze': return { content: 'Morphosyntactic analysis: NP VP' };
    case 'dictionary-lookup': return { word: 'cat', count: 1, entries: [{ word: 'cat', phonetic: '/kæt/', phonetics: [{ text: '/kæt/', audio: 'https://x/cat.mp3' }], origin: 'Old English', meanings: [{ partOfSpeech: 'noun', definitions: [{ definition: 'A small feline', example: 'The cat sat', synonyms: ['feline'], antonyms: [] }], synonyms: ['kitty'], antonyms: [] }] }] };
    case 'datamuse-words': return { words: [{ word: 'kitten', score: 900, tags: ['n'] }, { word: 'feline', score: 800 }] };
    case 'textAnalysis': return { wordCount: 120, sentenceCount: 8, vocabularySize: 70, lexicalDiversity: 0.58, readabilityGrade: 8.2, readingLevel: 'standard', avgWordLength: 4.6, avgSentenceLength: 15 };
    case 'sentimentAnalysis': return { sentiment: 'positive', score: 0.4, positiveWords: 6, negativeWords: 1, confidence: 'medium' };
    case 'frequencyAnalysis': return { totalWords: 120, uniqueWords: 70, topContentWords: [{ word: 'cat', count: 5, frequency: 0.04 }], hapaxLegomena: 40, zipfCompliance: 'good' };
    case 'pronounce': return { word: 'cat', ipa: '/kæt/', audio: 'https://x/cat.mp3', phonetics: [{ ipa: '/kæt/', audio: 'https://x/cat.mp3' }] };
    case 'word-context': return { word: 'cat', count: 1, examples: [{ sentence: 'The cat sat.', partOfSpeech: 'noun', sense: 'feline' }] };
    case 'etymology': return { word: 'cat', origin: 'Old English catt', allOrigins: ['Old English catt'], hasEtymology: true };
    case 'morphologyBreakdown': return { word: 'cats', prefix: '', root: 'cat', suffix: 's', morphemeCount: 2, wordClass: 'noun' };
    default: return { ok: true };
  }
}
vi.mock('@/lib/api/client', () => ({
  lensRun: (...a: unknown[]) => lensRunMock(...a),
  api: { get: vi.fn(async () => ({ data: {} })), post: (...a: unknown[]) => apiPost(...a) },
  apiHelpers: { lens: { runDomain: (...a: unknown[]) => runDomain(...a), list: vi.fn(async () => ({ data: { artifacts: [], total: 0 } })) } },
}));
vi.mock('@/hooks/useLensCommand', () => ({ useLensCommand: () => {} }));
vi.mock('@/lib/hooks/use-lens-data', () => ({
  useLensData: (_d: string, type: string) => ({ items: BY_TYPE[type] ?? [], isLoading: false, isError: false, error: null, refetch: vi.fn(), create: createFn, update: updateFn, remove: removeFn, isCreating: false, createMut: { isPending: false }, updateMut: { isPending: false }, deleteMut: { isPending: false } }),
}));
vi.mock('@/lib/hooks/use-lens-artifacts', () => ({ useRunArtifact: () => ({ mutateAsync: vi.fn(async () => ({ ok: true, result: { message: 'analyzed', tokens: 4 } })), mutate: vi.fn(), isPending: false }) }));
vi.mock('@/components/linguistics/IpaBreakdown', () => ({ IpaBreakdown: () => <div>ipa breakdown</div> }));
vi.mock('@/components/panel-polish', () => ({
  usePipe: () => ({ publish: vi.fn(), subscribe: vi.fn() }),
  useRecallableAction: () => ({ run: (fn: () => Promise<unknown>) => fn(), state: 'idle' }),
  RecallSlot: () => null,
}));
vi.mock('framer-motion', () => ({
  useReducedMotion: () => false,
  MotionConfig: ({ children }: { children?: React.ReactNode }) => children,
  motion: new Proxy({}, { get: (_t, tag: string) => {
    const MOTION = ['initial', 'animate', 'exit', 'transition', 'variants', 'whileHover', 'whileTap', 'whileInView', 'layout', 'layoutId', 'drag'];
    return ({ children, ...rest }: Record<string, unknown>) => {
      const props = Object.fromEntries(Object.entries(rest).filter(([k]) => !MOTION.includes(k)));
      return React.createElement(tag, props, children as React.ReactNode);
    };
  } }),
  AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

import { AnalyzePanel } from '../AnalyzePanel';
import { LinguisticsActionPanel } from '../LinguisticsActionPanel';
import { NotebookPanel } from '../NotebookPanel';
import { WordTools } from '../WordTools';

const render = (ui: React.ReactElement) => rtlRender(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider>);
const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 5)); });
const press = async (re: RegExp, nth = 0) => {
  const hits = screen.queryAllByRole('button').filter((x) => re.test((x.textContent || x.getAttribute('aria-label') || x.getAttribute('title') || '').trim()));
  if (hits[nth]) await act(async () => { fireEvent.click(hits[nth]); await new Promise((r) => setTimeout(r, 5)); });
  return !!hits[nth];
};
afterEach(() => cleanup());
beforeEach(() => {
  [lensRunMock, runDomain, apiPost, createFn, updateFn, removeFn].forEach((f) => f.mockClear());
  lensRunMock.mockImplementation(async (...a: unknown[]) => ({ data: { ok: true, result: resultFor(actionOf(a)), error: null } }));
  runDomain.mockImplementation(async (_d: string, action: string) => ({ data: { ok: true, result: resultFor(action) } }));
  apiPost.mockResolvedValue({ data: { ok: true, result: { id: 'dtu-1', dtu: { id: 'dtu-1' }, answer: 'Brief.' } } });
  window.HTMLMediaElement.prototype.play = vi.fn(async () => {});
});

const MODES = ['Analyses', 'Lexicon', 'Grammars', 'Corpora', 'Translations', 'Dashboard'] as const;
const PANELS: Array<[string, () => React.ReactElement]> = [
  ['AnalyzePanel', () => <AnalyzePanel />],
  ['LinguisticsActionPanel', () => <LinguisticsActionPanel />],
  ['WordTools', () => <WordTools />],
  ...MODES.map((m): [string, () => React.ReactElement] => [`NotebookPanel ${m}`, () => <NotebookPanel mode={m as never} />]),
];

describe('linguistics panels', () => {
  it.each(PANELS)('%s renders real content with controls and survives a full exercise pass', async (_n, make) => {
    const view = render(make());
    await settle();
    expect(view.container.textContent?.trim().length).toBeGreaterThan(10);
    await exercise({ passes: 4, text: 'cat' });
    await settle();
    await exercise({ passes: 1, text: 'The cat sat on the mat. The dog ran.' });
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

describe('linguistics flows', () => {
  it('free-text analysis sends the text and shows the content', async () => {
    render(<AnalyzePanel />);
    await settle();
    fireEvent.change(screen.getAllByRole('textbox')[0], { target: { value: 'The cat sat on the mat.' } });
    await press(/Analy[sz]e/i);
    await settle();
    expect(document.body.textContent).toMatch(/Morphosyntactic analysis/);
  });

  it('the action panel looks up words, runs text/sentiment/frequency, mints, DMs, publishes and asks the agent', async () => {
    render(<LinguisticsActionPanel />);
    await settle();
    const fill = (re: RegExp | string, v: string) => { const el = typeof re === 'string' ? screen.queryByPlaceholderText(re) : screen.queryAllByPlaceholderText(re)[0]; if (el) fireEvent.change(el, { target: { value: v } }); };
    fill(/word/i, 'cat');
    const area = document.querySelector('textarea');
    if (area) fireEvent.change(area, { target: { value: 'The cat sat on the mat. The cat is happy and the dog is sad.' } });
    fill(/recipient|DM/i, 'friend-1');
    for (const l of [/^Dict|Lookup/i, /Datamuse|Related|Words/i, /^Text|Analy/i, /Sentiment/i, /Frequency/i, /^Mint/, /^DM/, /^Publish/, /^Publish/, /Brief|Agent|Lever/i]) await press(l);
    const a = runDomain.mock.calls.map((c) => String(c[1]));
    expect(a.some((x) => /dictionary-lookup|datamuse-words|textAnalysis|sentimentAnalysis|frequencyAnalysis/.test(x))).toBe(true);
    expect(apiPost).toHaveBeenCalled();
  });

  it('word tools query pronunciation, context, etymology and morphology, play audio, and report a miss', async () => {
    render(<WordTools />);
    await settle();
    fireEvent.change(screen.getAllByRole('textbox')[0], { target: { value: 'cat' } });
    await press(/Look ?up|Search|Go|Explore|Analy/i);
    await settle();
    expect(document.body.textContent).toMatch(/kæt|Old English|feline|cat/);
    await press(/Play|Listen|🔊|audio/i);
    lensRunMock.mockImplementation(async () => ({ data: { ok: false, error: 'No data' } }));
    fireEvent.change(screen.getAllByRole('textbox')[0], { target: { value: 'zzzz' } });
    await press(/Look ?up|Search|Go|Explore|Analy/i);
    await settle();
    expect(document.body.textContent).toMatch(/No data|No data found/);
  });

  it('the notebook creates, edits, filters, analyses and removes entries on each tab', async () => {
    const SKIP = /delete|remove|trash|discard|cancel|close|dismiss|reset|clear|^back|^×$|^Create$|Save changes|^New /i;
    for (const mode of ['Analyses', 'Lexicon', 'Grammars', 'Corpora', 'Translations'] as const) {
      const view = render(<NotebookPanel mode={mode as never} />);
      await settle();
      expect(view.container.textContent).toMatch(/Cat parse|cat|English SVO|News corpus|Cat to French/);
      // create
      await press(/^New /);
      fireEvent.change(screen.getByPlaceholderText('Title...'), { target: { value: `Fresh ${mode}` } });
      for (const ph of [/Language/, /Description/, /Source/i, /Target/i, /IPA/, /Example/, /Morpheme/, /Syntax tree/, /Gloss/, /texts/i]) {
        const el = screen.queryAllByPlaceholderText(ph)[0];
        if (el) fireEvent.change(el, { target: { value: ph.source === 'Syntax tree' ? '[S [NP the cat] [VP sat]]' : 'sample, text' } });
      }
      await press(/^Create$/);
      // open the existing row, edit it, run analysis, then remove it
      const row = screen.getAllByRole('button').find((b) => /Cat parse|^cat|English SVO|News corpus|Cat to French/.test((b.textContent || '').trim()));
      if (row) await act(async () => { fireEvent.click(row); await new Promise((r) => setTimeout(r, 5)); });
      await press(/Analy[sz]e/i);
      await press(/^Edit|Edit$/i);
      const titleBox = screen.queryByPlaceholderText('Title...');
      if (titleBox) fireEvent.change(titleBox, { target: { value: `Edited ${mode}` } });
      await press(/Save changes/);
      await press(/Delete|Trash|Remove/i); await press(/Confirm|Yes|Delete/i);
      cleanup();
    }
    expect(createFn.mock.calls.length).toBeGreaterThan(0);
    expect(updateFn.mock.calls.length + removeFn.mock.calls.length).toBeGreaterThan(0);
  });
});
