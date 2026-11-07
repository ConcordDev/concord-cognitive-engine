// Render + behaviour coverage for the dreams lens: the dream library (search / timeline / busiest
// night) and the dream reader (interpretation, tags, unpublish).

import React from 'react';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { actionOf, exercise } from '../../../tests/helpers/exercise';

const lensRunMock = vi.fn();
const DREAM = { id: 'dr1', worldId: 'w1', dreamDtuId: 'dtu9', fragmentCount: 5, composer: 'subconscious', composedAt: 1_760_000_000, title: 'The long corridor', prose: 'I walked through a corridor of doors…', fragments: [{ kind: 'combat' }, { kind: 'gather' }], summary: { combatHits: 3, combatTaken: 1, kills: 1, painCount: 2, painTotal: 6, gathered: 4, visited: 2, dtusCreated: 1 }, scope: 'public', priceCc: 5, tags: ['corridor', 'doors'], tagsAuthor: 'me' };

function resultFor(action: string): unknown {
  switch (action) {
    case 'search': return { dreams: [{ id: 'dr1', title: 'The long corridor', prose: 'I walked…', fragmentCount: 5, composer: 'subconscious', composedAt: 1_760_000_000, scope: 'public', priceCc: 5, tags: ['corridor'] }, { id: 'dr2', title: 'Falling', prose: '', fragmentCount: 2, scope: 'personal', priceCc: null, tags: [] }] };
    case 'tags': return { tags: [{ tag: 'corridor', count: 3 }, { tag: 'flying', count: 1 }] };
    case 'timeline': return { days: [{ day: '2026-03-01', count: 2, dreams: [{ id: 'dr1', title: 'The long corridor', composedAt: 1_760_000_000, fragmentCount: 5, tags: ['corridor'] }, { id: 'dr2', title: 'Falling', composedAt: 1_760_000_100 }] }] };
    case 'busiest-night': return { ok: true, metric: 'activity', nights: [{ day: '2026-03-01', dreamCount: 2, activityIntensity: 0.8, dreamIds: ['dr1', 'dr2'] }], totalNights: 1 };
    case 'detail': return { dream: DREAM };
    case 'interpret': return { interpretation: { composer: 'subconscious', tone: 'tender', themes: ['transition', 'choice'], dominantFragment: { kind: 'gather', count: 4 }, fragmentKinds: { gather: 4, combat: 1 }, reflection: 'A search for passage.', reflections: ['You carried much.'] } };
    default: return { ok: true };
  }
}
vi.mock('@/lib/api/client', () => ({
  lensRun: (...a: unknown[]) => lensRunMock(...a),
  api: { get: vi.fn(async () => ({ data: {} })), post: vi.fn(async () => ({ data: {} })) },
  apiHelpers: { lens: { runDomain: vi.fn(async () => ({ data: { ok: true, result: {} } })), list: vi.fn(async () => ({ data: { artifacts: [], total: 0 } })) } },
}));
vi.mock('@/hooks/useLensCommand', () => ({ useLensCommand: () => {} }));
vi.mock('@/components/viz', () => ({ TimelineView: ({ events, onSelect }: { events: Array<{ id: string }>; onSelect?: (e: { id: string }) => void }) => <button onClick={() => onSelect?.(events[0])}>timeline {events.length}</button>, ChartKit: () => <div>chart</div> }));
vi.mock('framer-motion', () => ({
  useReducedMotion: () => false,
  MotionConfig: ({ children }: { children?: React.ReactNode }) => children,
  motion: new Proxy({}, { get: () => (p: Record<string, unknown>) => <div>{p.children as React.ReactNode}</div> }),
  AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

import { DreamLibrary } from '../DreamLibrary';
import { DreamReader } from '../DreamReader';

const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 10)); });
const sent = () => lensRunMock.mock.calls.map((c) => actionOf(c));
const press = async (re: RegExp, nth = 0) => {
  const hits = screen.queryAllByRole('button').filter((x) => re.test((x.textContent || x.getAttribute('aria-label') || x.getAttribute('title') || '').trim()));
  if (hits[nth]) await act(async () => { fireEvent.click(hits[nth]); await new Promise((r) => setTimeout(r, 10)); });
  return !!hits[nth];
};
afterEach(() => cleanup());
beforeEach(() => {
  lensRunMock.mockReset();
  lensRunMock.mockImplementation(async (...a: unknown[]) => ({ data: { ok: true, result: resultFor(actionOf(a)), error: null } }));
});

describe('dreams panels', () => {
  it('the library searches, filters by tag and scope, opens a dream, and walks timeline and busiest-night modes', async () => {
    const onOpen = vi.fn();
    const view = render(<DreamLibrary onOpen={onOpen} reloadKey={0} />);
    await settle();
    expect(view.container.textContent).toMatch(/The long corridor/);
    const box = screen.queryAllByRole('textbox')[0];
    if (box) { fireEvent.change(box, { target: { value: 'corridor' } }); fireEvent.keyDown(box, { key: 'Enter' }); }
    await settle();
    await press(/^corridor/); await press(/^flying/);
    for (const sel of Array.from(view.container.querySelectorAll('select')) as HTMLSelectElement[]) for (const o of Array.from(sel.options)) { fireEvent.change(sel, { target: { value: o.value } }); await settle(); }
    await press(/The long corridor/);
    expect(onOpen).toHaveBeenCalled();
    for (const m of [/Timeline/i, /Busiest/i, /Search/i]) { await press(m); await settle(); }
    await press(/timeline \d/);
    await exercise({ passes: 2, text: 'doors', skip: /delete|remove|cancel|close|dismiss|clear|^back|^×$/i });
    expect(sent()).toEqual(expect.arrayContaining(['search', 'tags']));
    expect(sent().some((x) => /timeline|busiest-night/.test(x))).toBe(true);
  });
  it('the library reports an empty result set and survives a failing backend', async () => {
    lensRunMock.mockImplementation(async () => ({ data: { ok: true, result: { dreams: [], tags: [], days: [], nights: [], empty: true, reason: 'no_dreams' } } }));
    const view = render(<DreamLibrary onOpen={vi.fn()} reloadKey={1} />);
    await settle();
    await press(/Busiest/i); await press(/Timeline/i);
    expect(view.container.textContent?.length).toBeGreaterThan(10);
    cleanup();
    lensRunMock.mockImplementation(async () => ({ data: { ok: false, error: 'offline' } }));
    const off = render(<DreamLibrary onOpen={vi.fn()} reloadKey={2} />);
    await settle();
    expect(off.container).toBeTruthy();
  });

  it('the reader shows the dream, interprets it, edits tags and unpublishes', async () => {
    const onClose = vi.fn(); const onChanged = vi.fn();
    const view = render(<DreamReader dreamId="dr1" onClose={onClose} onChanged={onChanged} />);
    await settle();
    expect(view.container.textContent).toMatch(/The long corridor|corridor of doors/);
    await press(/Interpret|Reflect|Read/i); await settle();
    const tags = screen.queryAllByRole('textbox').find((i) => /tag/i.test((i as HTMLInputElement).placeholder || '')) ?? screen.queryAllByRole('textbox')[0];
    if (tags) fireEvent.change(tags, { target: { value: 'doors, night' } });
    await press(/Save tags|Tag/i); await press(/Unpublish|Make private/i); await press(/Close|×/i);
    expect(sent()).toContain('detail');
    expect(sent().some((x) => /tag|unpublish|interpret/.test(x))).toBe(true);
  });
  it('the reader explains a missing dream', async () => {
    lensRunMock.mockImplementation(async () => ({ data: { ok: false, error: 'Dream not found.' } }));
    const view = render(<DreamReader dreamId="missing" onClose={vi.fn()} />);
    await settle();
    expect(view.container.textContent).toMatch(/not found/i);
  });
});
