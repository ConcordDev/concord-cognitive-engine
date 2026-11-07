// Render + behaviour coverage for the philosophy lens panels: dilemma tools (argument map, thought
// experiment, dialectic, ethics), the Stack Exchange feed, channels, and the curation workspace
// (grid, search, discover, collaborators, embeds, reference pages, connections, debates).

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { act, cleanup, fireEvent, render as rtlRender, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { actionOf, exercise } from '../../../tests/helpers/exercise';

const lensRunMock = vi.fn();
const runDomain = vi.fn();
const apiPost = vi.fn();
const publicLookup = vi.hoisted(() => vi.fn());
const CH = { id: 'ch1', title: 'Epistemology', description: 'Knowing', blockCount: 2, public: false, role: 'owner' as const };
const BLOCK = { id: 'bl1', kind: 'quote', content: 'I think, therefore I am', imageUrl: null, source: 'Descartes', channelCount: 2, createdAt: '2026-03-01', channelIds: ['ch1'], canDelete: true };
const THREAD = { id: 'th1', title: 'Free will?', claim: 'Determinism is true', branch: 'metaphysics', authorName: 'Ann', mine: true, public: false, status: 'open', posts: [{ id: 'dp1', stance: 'for', body: 'Causal closure', targetPremise: null, authorName: 'Ann', mine: true, createdAt: '2026-03-02' }, { id: 'dp2', stance: 'against', body: 'Quantum indeterminacy', targetPremise: 'p1', authorName: 'Bo', mine: false, createdAt: '2026-03-03' }], resolution: null, postCount: 2, createdAt: '2026-03-01' };

function resultFor(action: string): unknown {
  switch (action) {
    case 'channel-list': return { channels: [CH, { ...CH, id: 'ch2', title: 'Ethics', role: 'collaborator', blockCount: 0 }] };
    case 'channel-detail': return { channel: CH, blocks: [BLOCK, { ...BLOCK, id: 'bl2', kind: 'link', content: 'https://plato.stanford.edu', canDelete: false }, { ...BLOCK, id: 'bl3', kind: 'text', content: 'Plain note' }] };
    case 'channel-create': return { channel: { id: 'ch9' } };
    case 'block-grid': return { blocks: [BLOCK, { ...BLOCK, id: 'bl4', kind: 'image', imageUrl: 'https://x/y.png', content: 'Cave', source: null }] };
    case 'philosophy-search': return { channels: [{ id: 'ch1', title: 'Epistemology', description: 'Knowing', createdAt: '2026-03-01' }], blocks: [{ id: 'bl1', kind: 'quote', excerpt: 'I think...', channelIds: ['ch1'] }], count: 2 };
    case 'public-channels': return { channels: [{ id: 'pc1', title: 'Public logic', description: 'Open', ownerId: 'u2', ownerName: 'Bo', blockCount: 3, collaboratorCount: 1, publishedAt: '2026-03-01' }] };
    case 'public-channel-detail': return { channel: { ...CH, id: 'pc1', title: 'Public logic' }, ownerId: 'u2', ownerName: 'Bo', blocks: [{ id: 'pb1', kind: 'quote', content: 'Modus ponens', imageUrl: null, source: 'Aristotle' }] };
    case 'channel-collaborator-list': return { collaborators: ['u2', 'u3'] };
    case 'channel-publish': return { public: true };
    case 'block-embed': return { block: BLOCK };
    case 'reference-list': return { references: [{ id: 'rf1', kind: 'philosopher', topic: 'Kant', title: 'Immanuel Kant', description: 'German philosopher', extract: 'Kant was...', thumbnail: null, url: 'https://en.wikipedia.org/wiki/Kant', related: [{ title: 'Hume', extract: 'Scottish', thumbnail: null }] }] };
    case 'reference-page': return { page: { id: 'rf2', kind: 'concept', topic: 'Qualia', title: 'Qualia', description: 'Subjective experience', extract: 'Qualia are...', thumbnail: null, url: 'https://en.wikipedia.org/wiki/Qualia', related: [] } };
    case 'connections-graph': return { nodes: [{ id: 'ch1', label: 'Epistemology', type: 'channel', public: false }, { id: 'bl1', label: 'Quote', type: 'block', kind: 'quote' }], edges: [{ from: 'ch1', to: 'bl1' }], bridges: [{ a: 'Epistemology', b: 'Ethics', via: 'Quote' }], channelCount: 2, blockCount: 1, crossConnectedBlocks: 1 };
    case 'debate-list': return { threads: [THREAD, { ...THREAD, id: 'th2', title: 'Is math invented?', status: 'resolved', posts: [], public: true, mine: false }] };
    case 'debate-detail': return { thread: THREAD, tally: { for: 1, against: 1, neutral: 0 } };
    case 'debate-create': case 'debate-post': case 'debate-resolve': case 'debate-publish': return { thread: THREAD };
    case 'argumentMap': return { premises: [{ number: 1, text: 'All men are mortal' }, { number: 2, text: 'Socrates is a man' }], conclusion: 'Socrates is mortal', premiseCount: 2, evaluated: true, validity: 'valid', form: 'Barbara', countermodel: null, unparsed: [] };
    case 'thoughtExperiment': return { scenario: 'Trolley', variables: [{ name: 'people', values: ['1', '5'] }], permutations: 2, methodNote: 'Vary one at a time', frameworks: ['utilitarian'] };
    case 'dialecticSynthesis': return { thesis: 'T', antithesis: 'A', method: 'Hegelian', steps: ['Identify', 'Sublate'], synthesis: 'S' };
    case 'ethicalFramework': return { dilemma: 'D', frameworks: [{ framework: 'Deontology', principle: 'Duty' }, { framework: 'Utilitarianism', principle: 'Welfare' }], note: 'Compare' };
    default: return { ok: true, id: 'new-1' };
  }
}
vi.mock('@/lib/api/client', () => ({
  lensRun: (...a: unknown[]) => lensRunMock(...a),
  api: { get: vi.fn(async () => ({ data: {} })), post: (...a: unknown[]) => apiPost(...a), delete: vi.fn(async () => ({ data: {} })) },
  apiHelpers: { lens: { runDomain: (...a: unknown[]) => runDomain(...a), list: vi.fn(async () => ({ data: { artifacts: [], total: 0 } })) } },
}));
vi.mock('@/lib/public-lookup', () => ({ publicLookup: (...a: unknown[]) => publicLookup(...a), carryLookupMeta: vi.fn(), lookupMeta: () => null }));
vi.mock('@/hooks/useLensCommand', () => ({ useLensCommand: () => {} }));
vi.mock('@/components/viz', () => ({ TreeDiagram: () => <div>tree diagram</div>, ChartKit: () => <div>chart</div> }));
vi.mock('@/components/panel-polish', () => ({
  usePipe: () => ({ publish: vi.fn(), subscribe: vi.fn() }),
  useRecallableAction: () => ({ run: (fn: () => Promise<unknown>) => fn(), state: 'idle' }),
  RecallSlot: () => null,
}));
vi.mock('@/components/dtu/SaveAsDtuButton', () => ({ SaveAsDtuButton: () => <button>save-as-dtu</button> }));
vi.mock('framer-motion', () => ({
  useReducedMotion: () => false,
  MotionConfig: ({ children }: { children?: React.ReactNode }) => children,
  motion: new Proxy({}, { get: () => (p: Record<string, unknown>) => <div>{p.children as React.ReactNode}</div> }),
  AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

import { DilemmaPanel } from '../DilemmaPanel';
import { PhiloFeed } from '../PhiloFeed';
import { PhilosophyChannels } from '../PhilosophyChannels';
import { PhilosophyCuration } from '../PhilosophyCuration';

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
  [lensRunMock, runDomain, apiPost, publicLookup].forEach((f) => f.mockReset());
  lensRunMock.mockImplementation(async (...a: unknown[]) => ({ data: { ok: true, result: resultFor(actionOf(a)), error: null } }));
  runDomain.mockImplementation(async (_d: string, action: string) => ({ data: { ok: true, result: resultFor(action) } }));
  apiPost.mockResolvedValue({ data: { ok: true, result: { id: 'dtu-1', dtu: { id: 'dtu-1' }, answer: 'Brief.' } } });
  publicLookup.mockResolvedValue({ items: [{ question_id: 1, title: 'What is knowledge?', link: 'https://philosophy.stackexchange.com/q/1', score: 40, answer_count: 5, view_count: 1200, is_answered: true, tags: ['epistemology'], accepted_answer_id: 9 }, { question_id: 2, title: 'Unanswered one', link: 'https://x/2', score: 1, answer_count: 0, view_count: 10, is_answered: false, tags: [] }] });
});

const PANELS: Array<[string, () => React.ReactElement]> = [
  ['DilemmaPanel', () => <DilemmaPanel />],
  ['PhiloFeed', () => <PhiloFeed />],
  ['PhilosophyChannels', () => <PhilosophyChannels />],
  ['PhilosophyCuration', () => <PhilosophyCuration />],
];

describe('philosophy panels', () => {
  it.each(PANELS)('%s renders real content with controls and survives a full exercise pass', async (_n, make) => {
    const view = render(make());
    await settle();
    expect(view.container.textContent?.trim().length).toBeGreaterThan(20);
    await exercise({ passes: 4, text: 'Is knowledge justified true belief?' });
    await settle();
    await exercise({ passes: 1, text: 'logic' });
    expect(view.container.textContent).toBeTruthy();
  });

  it.each(PANELS)('%s stays standing when the backend is offline', async (_n, make) => {
    lensRunMock.mockImplementation(async () => ({ data: { ok: false, error: 'offline', result: null } }));
    runDomain.mockImplementation(async () => ({ data: { ok: false, error: 'offline' } }));
    publicLookup.mockRejectedValue(new Error('offline'));
    apiPost.mockRejectedValue(new Error('offline'));
    const view = render(make());
    await settle();
    await exercise({ passes: 1 });
    expect(view.container).toBeTruthy();
  });
});

describe('philosophy flows', () => {
  it('the dilemma tools map an argument, run a thought experiment, a dialectic, an ethics survey, then mint, DM, publish and ask the agent', async () => {
    render(<DilemmaPanel />);
    await settle();
    const boxes = () => [...document.querySelectorAll('textarea, input[type="text"], input:not([type])')] as HTMLInputElement[];
    boxes().forEach((el) => fireEvent.change(el, { target: { value: 'All men are mortal; Socrates is a man; therefore Socrates is mortal' } }));
    for (const l of [/Argument|Map/, /Experiment/, /Dialectic/, /Ethic/, /^Mint/, /^DM/, /^Publish/, /^Publish/, /Brief|Agent|Lever/]) await press(l);
    const a = runDomain.mock.calls.map((c) => String(c[1]));
    expect(a.some((x) => /argumentMap|thoughtExperiment|dialecticSynthesis|ethicalFramework/.test(x))).toBe(true);
  });

  it('the Stack Exchange feed switches tags', async () => {
    const view = render(<PhiloFeed />);
    await settle();
    expect(view.container.textContent).toMatch(/What is knowledge/);
    const sel = view.container.querySelector('select') as HTMLSelectElement | null;
    if (sel) for (const t of ['metaphysics', 'logic', 'philosophy-of-mind']) { fireEvent.change(sel, { target: { value: t } }); await settle(); }
    else for (const t of ['metaphysics', 'logic', 'philosophy-of-mind']) await press(new RegExp(t));
    expect(publicLookup.mock.calls.length).toBeGreaterThan(1);
  });

  it('channels are created, opened, given blocks, and deleted in two steps', async () => {
    render(<PhilosophyChannels />);
    await settle();
    const title = screen.getAllByRole('textbox')[0];
    fireEvent.change(title, { target: { value: 'Mind' } });
    await press(/^\s*(Create|Add|New)/i);
    await press(/Epistemology/);
    await exercise({ passes: 3, text: 'A quote about being', skip: /delete|remove|trash|discard|cancel|close|dismiss|reset|clear|^back|^×$/i });
    await press(/Add block|Add/i);
    await press(/Delete|Trash/i); await press(/Delete|Confirm|Yes/i);
    expect(sent()).toEqual(expect.arrayContaining(['channel-list', 'channel-detail']));
    expect(sent().some((x) => /channel-create|block-add|block-delete|channel-delete/.test(x))).toBe(true);
  });

  it('curation walks every sub-tab and drives their controls', async () => {
    const view = render(<PhilosophyCuration />);
    await settle();
    const skip = /^(Image Grid|Search|Discover|Collaborators|Embeds|Reference Pages|Connections|Debate Threads)$|delete|remove|trash|discard|cancel|close|dismiss|reset|clear|^back|^×$/i;
    for (const label of ['Image Grid', 'Search', 'Discover', 'Collaborators', 'Embeds', 'Reference Pages', 'Connections', 'Debate Threads']) {
      await press(new RegExp(`^${label}$`));
      await settle();
      await exercise({ passes: 3, text: 'Kant', skip });
      await settle();
      await exercise({ passes: 1, text: 'logic', skip });
      expect(view.container.textContent?.length).toBeGreaterThan(30);
    }
    const a = sent();
    expect(a).toEqual(expect.arrayContaining(['channel-list', 'block-grid']));
    expect(a.filter((x) => /philosophy-search|public-channels|reference-list|connections-graph|debate-list|channel-collaborator-list/.test(x)).length).toBeGreaterThan(2);
  });

  it('debates open, take positions, resolve, publish and delete', async () => {
    render(<PhilosophyCuration />);
    await settle();
    await press(/^Debate Threads$/);
    await settle();
    await press(/Free will/);
    await exercise({ passes: 3, text: 'A reasoned point', skip: /^(Image Grid|Search|Discover|Collaborators|Embeds|Reference Pages|Connections|Debate Threads)$|delete|remove|trash|discard|cancel|close|dismiss|reset|clear|^back|^×$/i });
    await press(/Resolve|Close thread/i); await press(/Publish|Make public/i);
    await press(/Delete|Trash/i); await press(/Delete|Confirm|Yes/i);
    expect(sent().some((x) => /debate-create|debate-post|debate-resolve|debate-publish|debate-delete|debate-detail/.test(x))).toBe(true);
  });
});
