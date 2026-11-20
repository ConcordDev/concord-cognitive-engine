/**
 * The Binder (DTUs lens): the default view asks only for the valuable
 * shelves and says how many cards are kept out of sight; filtering a hidden
 * shelf in asks for it; an open card flips to its back with the check
 * receipt; publish refusals are said in words; the designer saves exactly
 * the choices made; two cards on the fusion table fuse into a new card; the
 * older ?id= link opens a card.
 */
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const lensRun = vi.fn();
vi.mock('@/lib/api/client', () => ({ lensRun: (...a: unknown[]) => lensRun(...a), api: { delete: vi.fn(), patch: vi.fn() } }));
vi.mock('@/hooks/useLensCommand', () => ({ useLensCommand: () => {} }));
vi.mock('@/hooks/useLensNav', () => ({ useLensNav: () => {} }));
vi.mock('@/components/lens/LensAgentFab', () => ({ default: () => null }));
vi.mock('@/components/dtus/WorkbenchPanel', () => ({ WorkbenchPanel: () => null }));
vi.mock('@/components/dtus/OpsPanel', () => ({ OpsPanel: () => null }));
vi.mock('@/components/dtus/TrendingDtus', () => ({ TrendingDtus: () => null }));
vi.mock('@/components/dtu/DTUQuickCreate', () => ({ DTUQuickCreate: () => null }));

import { Binder } from '@/components/dtus/binder/Binder';

const design = { frame: 'plain', palette: 'paper', accent: null, layout: 'art-top', typeface: 'serif', subtitle: null, coverDtuId: null, coverMediaId: null };
const card = (id: string, over: Record<string, unknown> = {}) => ({
  id, title: `Card ${id}`, summary: 'A summary.', shelf: 'knowledge', shelfReason: 'an explanation', kind: 'user_authored', domain: 'engineering',
  tier: 'regular', image: null, design, owner: 'me', isMine: true, published: false, check: null, foil: false, needsCheck: true, cites: 0, builtOn: 0, createdAt: '2026-11-20T00:00:00Z', ...over,
});
const FACETS = { counts: { works: 1, specs: 0, documents: 0, knowledge: 2, data: 0, records: 3, parts: 0, system: 1 }, hiddenTotal: 4, domains: [] };
const env = (result: unknown) => ({ data: { ok: true, result } });
function route(map: Record<string, (i: Record<string, unknown>) => unknown>) {
  lensRun.mockImplementation(async (_d: string, action: string, input: Record<string, unknown>) => {
    const out = action in map ? map[action](input) : {};
    return out && typeof out === 'object' && 'data' in (out as object) ? out : env(out);
  });
}
const calls = (action: string) => lensRun.mock.calls.filter((c) => c[1] === action).map((c) => c[2] as Record<string, unknown>);

beforeEach(() => { lensRun.mockReset(); window.history.replaceState({}, '', '/lenses/dtus'); });
afterEach(cleanup);

describe('the binder page', () => {
  it('asks only for the valuable shelves, and says what is kept out of sight', async () => {
    route({ 'shelf-facets': () => FACETS, 'shelf-browse': () => ({ cards: [card('a'), card('b', { shelf: 'works' })], total: 2 }) });
    render(<Binder />);
    await screen.findByTestId('bd-pockets');
    expect(calls('shelf-browse')[0].shelves).toEqual(['works', 'specs', 'documents', 'knowledge']);
    expect(await screen.findByText('4 kept out of sight:')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Records 3/ }));
    await waitFor(() => expect(calls('shelf-browse').at(-1)?.shelves).toEqual(['works', 'specs', 'documents', 'knowledge', 'records']));
    // a hidden shelf with nothing in it is not offered
    expect(screen.queryByRole('button', { name: /^Data/ })).toBeNull();
  });

  it('a shelf tab asks for that shelf alone', async () => {
    route({ 'shelf-facets': () => FACETS, 'shelf-browse': () => ({ cards: [], total: 0 }) });
    render(<Binder />);
    fireEvent.click(await screen.findByRole('tab', { name: /Works/ }));
    await waitFor(() => expect(calls('shelf-browse').at(-1)?.shelves).toEqual(['works']));
    expect(await screen.findByText('No cards on this shelf yet.')).toBeTruthy();
  });
});

describe('an open card', () => {
  const back = {
    claims: ['2 + 2 = 4'], definitions: [], body: null, tags: [], sources: [],
    receipt: { outcome: 'VERIFIED', checkedAt: '2026-11-20T00:00:00Z', current: true, claims: [{ kind: 'arithmetic', checker: 'arithmetic', result: 'verified', detail: '2 + 2 = 4', text: '2 + 2 = 4' }] },
    parents: [], children: [], publishBlock: null,
  };

  it('the older ?id= link opens the card, and it flips to the receipt', async () => {
    window.history.replaceState({}, '', '/lenses/dtus?id=a');
    route({ 'card-get': () => ({ card: card('a', { foil: true, check: { outcome: 'VERIFIED', checkedAt: 'x', current: true } }), back }), 'card-connections': () => ({ connections: [] }) });
    render(<Binder />);
    await screen.findByTestId('bd-stage');
    fireEvent.click(screen.getByTestId('bd-flip'));
    const b = screen.getByTestId('bd-back');
    expect(b.textContent).toMatch(/VERIFIED/);
    expect(b.textContent).toMatch(/arithmetic: 2 \+ 2 = 4/);
  });

  it('a refused publish is said in words', async () => {
    window.history.replaceState({}, '', '/lenses/dtus?card=a');
    route({
      'card-get': () => ({ card: card('a'), back: { ...back, receipt: null, publishBlock: { error: 'check_required', message: 'Knowledge is checked before it is published. Run the check on its current text first.' } } }),
      'card-connections': () => ({ connections: [] }),
      'card-publish': () => ({ data: { ok: false, error: 'no_outside_source' } }),
    });
    render(<Binder />);
    expect(await screen.findByText(/Run the check on its current text first/)).toBeTruthy();
    await act(async () => { fireEvent.click(screen.getByTestId('bd-publish')); });
    expect((await screen.findByRole('alert')).textContent).toMatch(/needs at least one outside source/);
  });

  it('the designer saves exactly the choices made', async () => {
    window.history.replaceState({}, '', '/lenses/dtus?card=a');
    route({ 'card-get': () => ({ card: card('a'), back }), 'card-connections': () => ({ connections: [] }), 'shelf-browse': () => ({ cards: [], total: 0 }), 'card-design': () => ({ design }) });
    render(<Binder />);
    fireEvent.click(await screen.findByRole('button', { name: /Design the card/ }));
    const d = screen.getByTestId('bd-designer');
    fireEvent.click(d.querySelector('button[aria-label="midnight stock"]') as HTMLElement);
    fireEvent.click(screen.getByRole('button', { name: 'Gilt' }));
    fireEvent.click(screen.getByRole('button', { name: 'Words only' }));
    await act(async () => { fireEvent.click(screen.getByTestId('bd-design-save')); });
    expect(calls('card-design')[0]).toEqual({ id: 'a', design: { frame: 'gilt', palette: 'midnight', layout: 'text', typeface: 'serif', accent: null, subtitle: null } });
  });

  it('a fusion candidate goes to the table with this card, and fusing opens the new card', async () => {
    window.history.replaceState({}, '', '/lenses/dtus?card=a');
    route({
      'card-get': (i) => ({ card: card(String(i.id)), back }),
      'card-connections': () => ({ connections: [{ card: card('s', { shelf: 'specs', title: 'Arch spec' }), score: 4, relation: 'complement', reasons: ['a spec to go with this knowledge', 'shares “thrust”'], sharedTerms: ['thrust'] }] }),
      'card-fuse': () => ({ card: card('new', { title: 'Arch, start to finish' }) }),
    });
    render(<Binder />);
    expect(await screen.findByText(/a spec to go with this knowledge · shares “thrust”/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /^Fuse$/ }));
    const tray = screen.getByTestId('bd-fuse');
    expect((tray.querySelector('input[aria-label="Name the new card"]') as HTMLInputElement).value).toBe('Card a × Arch spec');
    await act(async () => { fireEvent.click(screen.getByTestId('bd-fuse-go')); });
    expect(calls('card-fuse')[0]).toEqual({ aId: 'a', bId: 's', title: 'Card a × Arch spec', note: '' });
    await waitFor(() => expect(window.location.search).toBe('?card=new'));
  });
});
