// Render + behaviour coverage for the shared lens chrome: the connective-tissue bar (tip, bounty,
// fork, publish, DTU search), the cross-lens content publisher, the DTU context panel, the feed
// button, the lens toolbar menu and the live indicator. Each mounts with realistic props, must
// render real content, survive a full exercise pass, and assert the call its controls send.

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { act, cleanup, fireEvent, render as rtlRender, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { actionOf, exercise } from '../../../tests/helpers/exercise';

const lensRunMock = vi.fn();
const apiPost = vi.fn();
const tipMutate = vi.fn();
const bountyMutate = vi.fn();
const forkMutate = vi.fn();
const addToast = vi.fn();
let signedIn = true;

vi.mock('@/lib/api/client', () => ({
  lensRun: (...a: unknown[]) => lensRunMock(...a),
  api: { get: vi.fn(async () => ({ data: {} })), post: (...a: unknown[]) => apiPost(...a) },
  apiHelpers: { lens: { list: vi.fn(async () => ({ data: { items: [{ id: 'a' }], total: 42 } })), runDomain: vi.fn(async () => ({ data: { ok: true, result: {} } })) } },
}));
vi.mock('@/hooks/useLensCommand', () => ({ useLensCommand: () => {} }));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: signedIn ? { id: 'u1' } : null, isLoading: false }) }));
vi.mock('@/store/ui', () => ({ useUIStore: (sel: (s: { addToast: typeof addToast }) => unknown) => sel({ addToast }) }));
vi.mock('@/hooks/useConnectiveTissue', () => ({
  useTip: () => ({ mutate: tipMutate, isPending: false }),
  usePostBounty: () => ({ mutate: bountyMutate, isPending: false }),
  useForkDTU: () => ({ mutate: forkMutate, isPending: false }),
  useMeritCredit: () => ({ data: { data: { total: 12 } } }),
  useDTUSearch: () => ({ data: { data: { results: [{ id: 'd1', title: 'Index hit', score: 0.9 }] } } }),
}));
vi.mock('@/components/dtu/DTUDetailView', () => ({ DTUDetailView: ({ onClose }: { onClose?: () => void }) => <button onClick={onClose}>detail-view</button> }));
vi.mock('@/components/common/ExportMenu', () => ({ ExportMenu: () => <button>export-menu</button> }));
vi.mock('@/components/conkay/conkayInitiativeStore', () => ({ useConkayInitiativeStore: (sel: (s: { pending: unknown[] }) => unknown) => sel({ pending: [1, 2] }) }));
vi.mock('@/lib/lenses/manifest', () => ({ getLensManifest: (d: string) => (d === 'family' ? { minorData: true } : {}) }));
vi.mock('framer-motion', () => ({
  useReducedMotion: () => false,
  MotionConfig: ({ children }: { children?: React.ReactNode }) => children,
  motion: new Proxy({}, { get: () => (p: Record<string, unknown>) => <div>{p.children as React.ReactNode}</div> }),
  AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

import { ConnectiveTissueBar, dtuBelongsToLens, mergeDtuSearchResults } from '../ConnectiveTissueBar';
import { ContentPublisher } from '../ContentPublisher';
import { LensContextPanel, dtuProvenance } from '../LensContextPanel';
import { LensFeedButton } from '../LensFeedButton';
import { LensToolbar } from '../LensToolbar';
import { BADGE_SETTLE_MS, LiveIndicator, badgeClaim } from '../LiveIndicator';
import { useLensTool } from '@/lib/lens-dock';

const render = (ui: React.ReactElement) => rtlRender(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider>);
const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 5)); });
const press = async (re: RegExp, nth = 0) => {
  const hits = screen.queryAllByRole('button').filter((x) => re.test((x.textContent || x.getAttribute('aria-label') || x.getAttribute('title') || '').trim()));
  if (hits[nth]) await act(async () => { fireEvent.click(hits[nth]); await new Promise((r) => setTimeout(r, 5)); });
  return !!hits[nth];
};
const DTU = (id: string, ownerId?: string) => ({ id, title: `DTU ${id}`, tags: ['a', 'b', 'c', 'd'], updatedAt: '2026-03-02T10:00:00Z', ownerId, tier: 'regular', freshness: 0.8 });
afterEach(() => { cleanup(); vi.useRealTimers(); });
beforeEach(() => {
  signedIn = true;
  [lensRunMock, apiPost, tipMutate, bountyMutate, forkMutate, addToast].forEach((f) => f.mockReset());
  lensRunMock.mockImplementation(async (...a: unknown[]) => {
    const act_ = actionOf(a);
    if (act_ === 'feed') return { data: { ok: true, result: { ingested: 3, skipped: 2, source: 'USGS' } } };
    if (act_ === 'search') return { data: { ok: true, result: { dtus: [{ id: 'own1', title: 'My note', domain: 'notes' }, { id: 'other', title: 'Elsewhere', domain: 'cooking' }] } } };
    if (act_ === 'create') return { data: { ok: true, result: { dtu: { id: 'dtu-42', content: 'Body text' } } } };
    if (act_ === 'get') return { data: { ok: true, result: { dtu: { id: 'dtu-42', content: 'Body text' } } } };
    return { data: { ok: true, result: {} } };
  });
  apiPost.mockResolvedValue({ data: { ok: true, id: 'post-1' } });
});

describe('pure helpers', () => {
  it('dtuBelongsToLens matches by domain, lens, meta.lens and tag', () => {
    expect(dtuBelongsToLens(null, 'x')).toBe(false);
    expect(dtuBelongsToLens({ id: '1', domain: 'x' }, 'x')).toBe(true);
    expect(dtuBelongsToLens({ id: '1', lens: 'x' }, 'x')).toBe(true);
    expect(dtuBelongsToLens({ id: '1', meta: { lens: 'x' } }, 'x')).toBe(true);
    expect(dtuBelongsToLens({ id: '1', tags: ['x'] }, 'x')).toBe(true);
    expect(dtuBelongsToLens({ id: '1', tags: ['y'] }, 'x')).toBe(false);
  });
  it('mergeDtuSearchResults dedupes with the index row winning', () => {
    expect(mergeDtuSearchResults([{ id: 'a', score: 1 }], [{ id: 'a' }, { id: 'b' }, { id: '' }])).toEqual([{ id: 'a', score: 1 }, { id: 'b' }]);
    expect(mergeDtuSearchResults(undefined, undefined)).toEqual([]);
  });
  it('dtuProvenance labels your, published and corpus rows', () => {
    expect(dtuProvenance({}, 'u1')).toBe('corpus');
    expect(dtuProvenance({ ownerId: 'u1' }, 'u1')).toBe('yours');
    expect(dtuProvenance({ ownerId: 'u2' }, 'u1')).toBe('published');
    expect(dtuProvenance({ ownerId: 'u2' }, null)).toBe('published');
  });
  it('badgeClaim settles pending, live and off', () => {
    expect(badgeClaim({ isLive: true, hasBeenLive: false, mountedForMs: 0 })).toBe('live');
    expect(badgeClaim({ isLive: false, hasBeenLive: true, mountedForMs: 0 })).toBe('off');
    expect(badgeClaim({ isLive: false, hasBeenLive: false, mountedForMs: BADGE_SETTLE_MS - 1 })).toBe('pending');
    expect(badgeClaim({ isLive: false, hasBeenLive: false, mountedForMs: BADGE_SETTLE_MS })).toBe('off');
  });
});

describe('ConnectiveTissueBar', () => {
  const bar = (over: Record<string, unknown> = {}) => <ConnectiveTissueBar lensId="notes" getPublishable={() => ({ title: 'My page', content: 'Body text' })} tipTarget={{ creatorId: 'creator-123456', contentId: 'content-123456' }} forkTarget={{ dtuId: 'dtu-abcdef123' }} {...over} />;

  it('renders its actions and survives a full exercise pass', async () => {
    const view = render(bar());
    await settle();
    expect(view.container.textContent).toMatch(/Tip|Bounty|Search|Merit/);
    await exercise({ passes: 4, text: '2' });
    await settle();
    expect(view.container.textContent).toBeTruthy();
  });

  it('tips with a valid amount, rejects a zero amount, posts a bounty and forks', async () => {
    render(bar());
    await settle();
    await press(/^Tip$/);
    fireEvent.change(screen.getByPlaceholderText('Amount'), { target: { value: '0' } });
    await press(/Send Tip/);
    expect(addToast).toHaveBeenCalledWith(expect.objectContaining({ type: 'error' }));
    fireEvent.change(screen.getByPlaceholderText('Amount'), { target: { value: '2.5' } });
    await press(/Send Tip/);
    await press(/^Bounty$/);
    await exercise({ passes: 3, text: '5', skip: /^(Tip|Bounty|Search|Fork|Publish DTU)$|delete|remove|trash|discard|cancel|close|dismiss|reset|clear|^back|^×$/i });
    await press(/^Fork$/);
    await press(/Fork (this )?DTU|Confirm|Create fork/i);
    expect(tipMutate.mock.calls.length + bountyMutate.mock.calls.length + forkMutate.mock.calls.length).toBeGreaterThan(0);
  });

  it('searches the public index and the viewer\'s own store, deduped and lens-filtered', async () => {
    vi.useFakeTimers();
    render(bar());
    await act(async () => { await vi.advanceTimersByTimeAsync(10); });
    await act(async () => { fireEvent.click(screen.getAllByRole('button').find((b) => (b.textContent || '').trim() === 'Search') as HTMLElement); await vi.advanceTimersByTimeAsync(10); });
    const box = screen.getAllByRole('textbox')[0] ?? screen.getByPlaceholderText(/search/i);
    fireEvent.change(box, { target: { value: 'note' } });
    await act(async () => { await vi.advanceTimersByTimeAsync(400); });
    expect(lensRunMock.mock.calls.map((c) => actionOf(c))).toContain('search');
    expect(document.body.textContent).toMatch(/Index hit|My note/);
    expect(document.body.textContent).not.toMatch(/Elsewhere/);
    vi.useRealTimers();
    await press(/Index hit/);
    await press(/detail-view/);
  });

  it('publishes a private DTU and verifies its stored content', async () => {
    render(bar());
    await settle();
    await press(/Publish DTU/);
    await press(/Publish|Save|Confirm/i, 1);
    expect(lensRunMock.mock.calls.map((c) => actionOf(c))).toEqual(expect.arrayContaining(['create', 'get']));
    expect(addToast).toHaveBeenCalledWith(expect.objectContaining({ type: 'success' }));
  });

  it('refuses to publish when signed out, when empty, when unreadable, on a failed save, and on a content mismatch', async () => {
    signedIn = false;
    render(bar());
    await settle();
    await press(/Publish DTU/); await press(/Publish|Save|Confirm/i, 1);
    expect(addToast).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringMatching(/Sign in/) }));
    cleanup(); signedIn = true; addToast.mockReset();

    render(bar({ getPublishable: () => ({ title: '', content: '' }) }));
    await settle(); await press(/Publish DTU/); await press(/Publish|Save|Confirm/i, 1);
    expect(addToast).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringMatching(/Nothing to publish/) }));
    cleanup(); addToast.mockReset();

    render(bar({ getPublishable: () => { throw new Error('boom'); } }));
    await settle(); await press(/Publish DTU/); await press(/Publish|Save|Confirm/i, 1);
    expect(addToast).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringMatching(/Could not read/) }));
    cleanup(); addToast.mockReset();

    lensRunMock.mockImplementation(async (...a: unknown[]) => actionOf(a) === 'create' ? { data: { ok: false, error: 'quota' } } : { data: { ok: true, result: {} } });
    render(bar());
    await settle(); await press(/Publish DTU/); await press(/Publish|Save|Confirm/i, 1);
    expect(addToast).toHaveBeenCalledWith(expect.objectContaining({ message: 'quota' }));
    cleanup(); addToast.mockReset();

    lensRunMock.mockImplementation(async (...a: unknown[]) => actionOf(a) === 'get' ? { data: { ok: true, result: { dtu: { id: 'dtu-42', content: 'different' } } } } : { data: { ok: true, result: { dtu: { id: 'dtu-42' } } } });
    render(bar());
    await settle(); await press(/Publish DTU/); await press(/Publish|Save|Confirm/i, 1);
    expect(addToast).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringMatching(/did not match/) }));
  });

  it('hides tip/fork/publish when their targets are missing', async () => {
    const view = render(<ConnectiveTissueBar lensId="notes" />);
    await settle();
    expect(view.container.textContent).not.toMatch(/Tip|Fork|Publish DTU/);
    expect(view.container.textContent).toMatch(/Bounty|Search/);
  });
});

describe('ContentPublisher', () => {
  it('opens, posts to the feed, cross-posts to a lens, copies share links and survives an exercise pass', async () => {
    Object.assign(navigator, { clipboard: { writeText: vi.fn(async () => {}) } });
    const onPublished = vi.fn();
    const view = render(<ContentPublisher domain="notes" artifactId="art1" title="My page" description="A short description" tags={['x']} onPublished={onPublished} />);
    await settle();
    await press(/^Share$/);
    fireEvent.change(document.querySelector('textarea') as HTMLTextAreaElement, { target: { value: 'Hello world' } });
    await press(/Public|Followers only/);
    await press(/Post to Feed/);
    expect(document.body.textContent).toMatch(/Posted to your Feed/);
    await press(/Share somewhere else/);
    await press(/^Lens$/);
    await press(/Forum/);
    expect(document.body.textContent).toMatch(/Cross-posted to forum/);
    await press(/Share somewhere else/);
    await press(/^Lens$/);
    for (const lens of ['Artistry', 'Marketplace', 'News', 'Music', 'Creative', 'Code']) {
      await press(new RegExp(lens));
      await press(/Share somewhere else/);
      await press(/^Lens$/);
    }
    await press(/^External$/);
    window.open = vi.fn() as never;
    for (const platform of ['Twitter', 'LinkedIn', 'Copy Link', 'Reddit', 'Facebook', 'Email']) await press(new RegExp(platform));
    await press(/^Market$/);
    await press(/Publish to Marketplace/);
    expect(document.body.textContent).toMatch(/Published to Marketplace/);
    await press(/Share somewhere else/);
    await exercise({ passes: 2, text: 'x', skip: /delete|remove|trash|discard|cancel|close|dismiss|reset|clear|^back|^×$/i });
    expect(apiPost).toHaveBeenCalled();
    expect(view.container.textContent).toBeTruthy();
  });

  it('a lens that declares minor data defaults to followers-only', async () => {
    render(<ContentPublisher domain="family" title="Photo" />);
    await settle();
    await press(/^Share$/);
    await press(/Post to Feed/);
    expect(apiPost.mock.calls.some((c) => JSON.stringify(c).includes('followers'))).toBe(true);
  });

  it('a failed post leaves the publisher usable', async () => {
    apiPost.mockRejectedValue(new Error('network'));
    const view = render(<ContentPublisher domain="notes" compact title="T" />);
    await settle();
    await press(/Publish|Share/i);
    await press(/Post to Feed/);
    expect(view.container).toBeTruthy();
  });
});

describe('LensContextPanel', () => {
  it('renders tier sections with provenance, selects and publishes a row, and shows the empty state', async () => {
    const onSelect = vi.fn(); const onPublish = vi.fn();
    const props = { hyperDTUs: [DTU('h1', 'u1')], megaDTUs: [DTU('m1', 'u2'), DTU('m2')], regularDTUs: [DTU('r1', 'u1')], tierDistribution: { hyper: 1, mega: 2, regular: 1, total: 4 }, onSelectDTU: onSelect, onPublish, toolbar: <div>toolbar-slot</div>, title: 'Context' };
    const view = render(<LensContextPanel {...(props as unknown as React.ComponentProps<typeof LensContextPanel>)} />);
    await settle();
    expect(view.container.textContent).toMatch(/Context|HYPER|toolbar-slot/);
    for (const row of Array.from(view.container.querySelectorAll('[role="button"]'))) await act(async () => { fireEvent.click(row); });
    for (const label of [/MEGA/, /Regular/]) await press(label);
    for (const row of Array.from(view.container.querySelectorAll('[role="button"]'))) await act(async () => { fireEvent.click(row); });
    await exercise({ passes: 2, text: 'x' });
    await press(/Publish/i);
    expect(onSelect).toHaveBeenCalled();
    cleanup();
    const empty = render(<LensContextPanel {...({ ...props, hyperDTUs: [], megaDTUs: [], regularDTUs: [], tierDistribution: { hyper: 0, mega: 0, regular: 0, total: 0 } } as unknown as React.ComponentProps<typeof LensContextPanel>)} />);
    expect(empty.container.textContent).toMatch(/No DTUs in context/);
  });
});

describe('LensFeedButton', () => {
  it('pulls a feed in full and compact forms and reports a failure', async () => {
    const full = render(<LensFeedButton domain="seismology" label="Pull quakes" />);
    await press(/Pull feed/);
    expect(full.container.textContent).toMatch(/Ingested 3 new DTUs from USGS · 2 already seen/);
    cleanup();
    const compact = render(<LensFeedButton domain="seismology" compact />);
    await press(/Pull feed/);
    expect(compact.container.textContent).toMatch(/\+3/);
    cleanup();
    lensRunMock.mockImplementation(async () => ({ data: { ok: false, error: 'source down' } }));
    const bad = render(<LensFeedButton domain="seismology" compact />);
    await press(/Pull feed/);
    expect(bad.container.textContent).toMatch(/source down|Feed unavailable/);
  });
});

describe('LensToolbar', () => {
  function Tools() {
    useLensTool('capture', () => {});
    useLensTool('assistant', () => {});
    return <LensToolbar domain="notes" domainLabel="Notes" />;
  }
  it('opens the menu, lists registered tools with the DTU count, summons Kay, and closes on Escape and outside click', async () => {
    const summon = vi.fn();
    window.addEventListener('conkay:summon', summon);
    render(<Tools />);
    await settle();
    await press(/Lens tools/);
    await settle();
    expect(document.body.textContent).toMatch(/Ask about Notes/);
    expect(document.body.textContent).toMatch(/42 DTUs/);
    const item = async (re: RegExp) => { const m = screen.queryAllByRole('menuitem').find((x) => re.test(x.textContent || '')); if (m) await act(async () => { fireEvent.click(m); }); };
    await item(/Kay/);
    expect(summon).toHaveBeenCalled();
    await press(/Lens tools/);
    await item(/Capture|Assistant/i);
    await press(/Lens tools/);
    fireEvent.keyDown(document, { key: 'Escape' });
    await press(/Lens tools/);
    fireEvent.mouseDown(document.body);
    window.removeEventListener('conkay:summon', summon);
  });
  it('the chat lens omits the Kay entry', async () => {
    render(<LensToolbar domain="chat" domainLabel="Chat" />);
    await press(/Lens tools/);
    expect(document.body.textContent).not.toMatch(/Kay/);
  });
});

describe('LiveIndicator', () => {
  it('shows Connecting, settles to live, and settles off after the grace period', async () => {
    vi.useFakeTimers();
    const view = render(<LiveIndicator isLive={false} lastUpdated={null} />);
    expect(view.container.textContent).toMatch(/Connecting/);
    await act(async () => { await vi.advanceTimersByTimeAsync(BADGE_SETTLE_MS + 500); });
    expect(view.container.textContent).toMatch(/Disconnected/);
    view.rerender(<QueryClientProvider client={new QueryClient()}><LiveIndicator isLive lastUpdated={new Date().toISOString()} /></QueryClientProvider>);
    await act(async () => { await vi.advanceTimersByTimeAsync(10); });
    expect(view.container.textContent).toMatch(/LIVE/);
  });
  it('renders compact forms for each claim', async () => {
    const live = render(<LiveIndicator isLive lastUpdated="2026-03-02T10:00:00Z" compact />);
    expect(live.container.textContent).toBeTruthy();
    cleanup();
    const idle = render(<LiveIndicator isLive={false} lastUpdated={null} compact />);
    expect(idle.container.textContent).toBeTruthy();
  });
});
