/**
 * The Auction House (Market lens): a visitor browses read-only, a member sees
 * their balance; the catalogue sends real filters; buying shows the fee and
 * the balance after and sends the price the buyer saw; the drawing can be
 * redone in the browser (and a tampered one is caught); the pay board only
 * lets a commissioner accept a submission that passes its checks.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { createHash } from 'node:crypto';

const lensRun = vi.fn();
vi.mock('@/lib/api/client', () => ({ lensRun: (...a: unknown[]) => lensRun(...a) }));
vi.mock('@/components/lens/LensAgentFab', () => ({ default: () => null }));
vi.mock('@/hooks/useLensNav', () => ({ useLensNav: () => {} }));

import MarketLensPage from '@/app/lenses/market/page';
import { AnonBrowseProvider } from '@/lib/anon-browse';
import { LotSheet } from '@/components/market/house/LotSheet';
import { ShowcaseRoom } from '@/components/market/house/ShowcaseRoom';
import { CommissionsRoom } from '@/components/market/house/CommissionsRoom';
import { lotNo, type Lot, type Showcase } from '@/components/market/house/houseApi';

const env = (result: unknown) => ({ data: { ok: true, result } });
const lot = (over: Partial<Lot> = {}): Lot => ({
  id: 'mel_abc123', title: 'Glulam beam sizing table', kind: 'dtu', price: 20, free: false, license: 'nonexclusive', status: 'active',
  seller: { id: 's1', name: 'Ada' }, cover: null, domain: 'engineering', tags: ['timber'], excerpt: 'Spans to 8 m.', counts: { claims: 4, definitions: 1, examples: 0, words: 120 },
  tier: 'regular', hasFile: false, artist: null, sold: 3, sold24h: 1, sold7d: 2, listedAt: new Date().toISOString(), ...over,
});
const terms = (balance: number | null) => ({ currency: 'CC', marketplaceFeeRate: 0.04, universalFeeRate: 0.0146, combinedRate: 0.0546, example: { price: 100, fee: 5.46, sellerNet: 94.54 }, licenses: ['nonexclusive'], maxPrice: 1e6, balance });
const SHOWCASE = { rules: { winnersPerHour: 6, cooldownHours: 24, formula: 'f' }, current: null, next: { hour: '2026-11-19T15', opensAt: new Date(Date.now() + 600_000).toISOString(), entrants: 0 }, standing: null, recent: [], now: new Date().toISOString() };
const catalogue = (lots: Lot[]) => ({ lots, total: lots.length, page: 1, pageSize: 24, sort: 'newest', inHouse: lots.length, facets: { kind: [{ value: 'dtu', count: lots.length }], domain: [{ value: 'engineering', count: lots.length }], tag: [{ value: 'timber', count: 1 }], license: [{ value: 'nonexclusive', count: 1 }], price: { min: 20, max: 20, free: 0 } } });

beforeEach(() => { lensRun.mockReset(); window.history.replaceState({}, '', '/lenses/market'); });
afterEach(cleanup);

function routeHouse(map: Record<string, unknown>) {
  lensRun.mockImplementation(async (_d: string, action: string) => (action in map ? env(map[action]) : env({})));
}

describe('entry', () => {
  it('a member sees their balance; a visitor sees a sign-in and still browses the catalogue', async () => {
    routeHouse({ 'house-terms': terms(42.5), 'house-catalogue': catalogue([lot()]), 'house-showcase': SHOWCASE });
    render(<AnonBrowseProvider value={false}><MarketLensPage /></AnonBrowseProvider>);
    await waitFor(() => expect(screen.getByTestId('ah-balance').textContent).toMatch(/42\.50 CC/));
    expect(await screen.findByRole('button', { name: /Lot .*Glulam beam sizing table, 20 CC/ })).toBeTruthy();
    expect(lensRun).toHaveBeenCalledWith('market', 'house-catalogue', expect.objectContaining({ sort: 'newest' }));
    cleanup();
    routeHouse({ 'house-terms': terms(null), 'house-catalogue': catalogue([lot()]), 'house-showcase': SHOWCASE });
    render(<AnonBrowseProvider value><MarketLensPage /></AnonBrowseProvider>);
    expect(screen.queryByTestId('ah-balance')).toBeNull();
    expect(screen.getAllByRole('link', { name: 'Sign in' }).length).toBeGreaterThan(0);
    expect(await screen.findByTestId('ah-grid')).toBeTruthy();
  });

  it('a facet click sends that filter to the house; an empty house says so honestly', async () => {
    routeHouse({ 'house-terms': terms(10), 'house-catalogue': catalogue([lot()]), 'house-showcase': SHOWCASE });
    render(<AnonBrowseProvider value={false}><MarketLensPage /></AnonBrowseProvider>);
    const facet = await screen.findByRole('button', { name: /engineering/ });
    fireEvent.click(facet);
    await waitFor(() => expect(lensRun).toHaveBeenCalledWith('market', 'house-catalogue', expect.objectContaining({ domain: 'engineering' })));
    cleanup();
    routeHouse({ 'house-terms': terms(10), 'house-catalogue': { ...catalogue([]), inHouse: 0 }, 'house-showcase': SHOWCASE });
    render(<AnonBrowseProvider value={false}><MarketLensPage /></AnonBrowseProvider>);
    await waitFor(() => expect(screen.getByTestId('ah-empty').textContent).toMatch(/The saleroom is empty tonight/));
  });
});

describe('buying a lot', () => {
  it('shows what the maker receives and the balance after, then buys at the price the buyer saw', async () => {
    let owned = false;
    lensRun.mockImplementation(async (_d: string, action: string) => {
      if (action === 'house-lot') return env({ lot: lot(), description: '', owned, isSeller: false, royalties: [], moreFromSeller: [], terms: terms(50) });
      if (action === 'house-buy') { owned = true; return env({ lotId: 'mel_abc123', balance: 30, lotStatus: 'active' }); }
      return env({});
    });
    const onBought = vi.fn();
    render(<LotSheet id="mel_abc123" signedIn onClose={() => {}} onOpen={() => {}} onBought={onBought} onReader={() => {}} />);
    fireEvent.click(await screen.findByTestId('ah-buy'));
    const confirm = screen.getByTestId('ah-confirm').textContent || '';
    expect(confirm).toMatch(/You pay\s*20 CC/);
    expect(confirm).toMatch(/18\.91 CC/); // 20 − 5.46% fee (1.09)
    expect(confirm).toMatch(/Your balance after\s*30 CC/);
    fireEvent.click(screen.getByTestId('ah-confirm-buy'));
    await waitFor(() => expect(onBought).toHaveBeenCalledWith(30));
    expect(lensRun).toHaveBeenCalledWith('market', 'house-buy', { id: 'mel_abc123', expectPrice: 20 });
    await waitFor(() => expect(screen.getByTestId('ah-owned')).toBeTruthy());
  });

  it('a balance too low cannot start a buy, and says by how much', async () => {
    lensRun.mockImplementation(async () => env({ lot: lot({ price: 80 }), description: '', owned: false, isSeller: false, royalties: [], moreFromSeller: [], terms: terms(12) }));
    render(<LotSheet id="mel_abc123" signedIn onClose={() => {}} onOpen={() => {}} onBought={() => {}} onReader={() => {}} />);
    await waitFor(() => expect((screen.getByTestId('ah-buy') as HTMLButtonElement).disabled).toBe(true));
    expect(screen.getByText(/You need 80 CC; your balance is 12 CC/)).toBeTruthy();
    expect(lotNo('mel_abc123')).toBe('C123');
  });
});

describe('the drawing', () => {
  const sha = (s: string) => createHash('sha256').update(s).digest('hex');
  const draw = (hour: string, prev: string, ids: string[]) => {
    const sorted = [...ids].sort();
    const seed = sha(`concord-house-showcase/1|${hour}|${prev}|${sorted.join(',')}`);
    const winners = sorted.map((id) => ({ id, s: sha(`${seed}|${id}`) })).sort((a, b) => (a.s < b.s ? -1 : 1)).slice(0, 6).map((x) => x.id);
    return { seed, winners };
  };
  const showcase = (tamper = false): Showcase => {
    const ids = ['u1', 'u2', 'u3', 'u4', 'u5', 'u6', 'u7', 'u8'];
    const d = draw('2026-11-19T14', 'genesis', ids);
    return {
      rules: { winnersPerHour: 6, cooldownHours: 24, formula: 'f' },
      current: { hour: '2026-11-19T14', seed: tamper ? d.seed.replace(/^./, (c) => (c === 'a' ? 'b' : 'a')) : d.seed, prevSeed: 'genesis', eligible: ids.map((id) => ({ id, name: id })), excluded: [], winners: d.winners.map((id) => ({ id, name: id, lots: [] })), drawnAt: '' },
      next: { hour: '2026-11-19T15', opensAt: new Date(Date.now() + 600_000).toISOString(), entrants: 3 },
      standing: { entered: false, hasActiveLot: true, lastWin: null, eligibleAgainAt: null, canEnter: true, reason: null },
      recent: [], now: new Date().toISOString(),
    };
  };
  it('the browser redoes the drawing and agrees with the published seed and winners', async () => {
    render(<ShowcaseRoom showcase={showcase()} signedIn onOpen={() => {}} onChanged={() => {}} />);
    fireEvent.click(screen.getByTestId('ah-recheck'));
    await waitFor(() => expect(screen.getByTestId('ah-recheck-ok')).toBeTruthy());
    expect(screen.getByTestId('ah-entrants').textContent).toMatch(/3 makers have entered/);
  });
  it('a tampered seed is caught', async () => {
    render(<ShowcaseRoom showcase={showcase(true)} signedIn onOpen={() => {}} onChanged={() => {}} />);
    fireEvent.click(screen.getByTestId('ah-recheck'));
    await waitFor(() => expect(screen.getByTestId('ah-recheck-bad')).toBeTruthy());
  });
});

describe('the pay board', () => {
  it('a commissioner can accept only a submission that passes every check', async () => {
    const c = { id: 'hc_1', title: 'Footbridge checks', brief: 'Vibration checks for a 30 m footbridge.', reward: 60, escrowHeld: 60, creatorNet: 56.72, criteria: { tags: ['bridges'], madeAfterPost: true }, status: 'open', poster: { id: 'p', name: 'Pat' }, mine: true, deadline: new Date(Date.now() + 86_400_000).toISOString(), acceptBy: new Date(Date.now() + 8 * 86_400_000).toISOString(), submissionsOpen: true, submissions: 2, passing: 1, createdAt: new Date().toISOString(), releasedNet: null, refunded: null };
    const sub = (id: string, passed: boolean) => ({ id, creator: { id: 'm', name: 'Mo' }, dtu: { id: `d${id}`, title: `DTU ${id}`, excerpt: 'x', claims: 3, words: 90 }, checks: [{ key: 'tags', label: 'Tagged bridges', pass: passed, detail: passed ? 'all present' : 'missing bridges' }], passed, status: 'submitted', note: null, createdAt: new Date().toISOString() });
    lensRun.mockImplementation(async (_d: string, action: string) => {
      if (action === 'board-list') return env({ commissions: [c], total: 1, escrowTotal: 60 });
      if (action === 'board-get') return env({ commission: c, submissions: [sub('a', true), sub('b', false)], balance: 10 });
      return env({});
    });
    render(<CommissionsRoom signedIn balance={10} onBalance={() => {}} onReader={() => {}} />);
    fireEvent.click(await screen.findByTestId('ah-commission'));
    await waitFor(() => expect(screen.getAllByTestId('ah-submission')).toHaveLength(2));
    const accepts = screen.getAllByTestId('ah-accept') as HTMLButtonElement[];
    expect(accepts.map((b) => b.disabled)).toEqual([false, true]);
    expect(screen.getByText('missing bridges')).toBeTruthy();
    expect(screen.getByTestId('ah-reward').textContent).toMatch(/60 CC/);
  });
});
