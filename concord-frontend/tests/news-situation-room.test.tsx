/**
 * The Situation Room (News): the map shows only what stories say, the
 * dossier explains every placement, bias that cannot be measured is said in
 * words (a real 0 stays 0), the feed's outage is named, and the reader's
 * tools (sort, source filter, records export) work on real responses.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import type { Situation, Story } from '@/components/news/room/roomApi';

const lensRun = vi.fn();
vi.mock('@/lib/api/client', () => ({ lensRun: (...a: unknown[]) => lensRun(...a) }));
vi.mock('@/components/lens/LensAgentFab', () => ({ default: () => null }));

import { rollUp, SituationRoom } from '@/components/news/room/SituationRoom';
import { Dossier } from '@/components/news/room/Dossier';
import { WorldMap } from '@/components/news/room/WorldMap';
import { heatOf, basisLine } from '@/components/news/room/roomApi';

const now = Date.now();
const at = (h: number) => new Date(now - h * 3_600_000).toISOString();
const story = (over: Partial<Story>): Story => ({
  id: Math.random().toString(36).slice(2), kind: 'library', title: 'T', url: null, source: 'Wire', category: 'world', at: at(1),
  places: [], basis: null, outletCountry: null, clusterId: 'c1', coverage: 1, ...over,
});
const STORIES: Story[] = [
  story({ title: 'Kremlin says Kyiv talks stalled', source: 'Wire A', at: at(1), places: [{ key: 'Russia', terms: ['Kremlin'] }, { key: 'Ukraine', terms: ['Kyiv'] }], basis: 'mentioned', clusterId: 'c1' }),
  story({ title: 'Ukrainian grain exports rebound', source: 'Harbor', at: at(6), places: [{ key: 'Ukraine', terms: ['Ukrainian'] }], basis: 'mentioned', clusterId: 'c2' }),
  story({ title: 'Parliament passes budget', source: 'Nairobi Post', at: at(2), places: [{ key: 'Kenya', terms: ['Kenya'] }], basis: 'outlet', outletCountry: 'Kenya', clusterId: 'c3' }),
  story({ title: 'Markets steady', source: 'Ledger', at: at(3), clusterId: 'c4' }),
];
const env = (result: unknown) => ({ data: { ok: true, result } });

describe('roll-up of what is in view', () => {
  it('counts places, splits named from outlet-only, links co-named places, and counts the last 3h', () => {
    const { regions, arcs } = rollUp(STORIES, now);
    const ua = regions.find((r) => r.key === 'Ukraine')!;
    expect([ua.count, ua.mentioned, ua.outlet, ua.sources, ua.last3h]).toEqual([2, 2, 0, 2, 1]);
    const ke = regions.find((r) => r.key === 'Kenya')!;
    expect([ke.mentioned, ke.outlet]).toEqual([0, 1]);
    expect(arcs).toEqual([{ a: 'Russia', b: 'Ukraine', count: 1 }]);
    expect(regions.map((r) => r.key)).not.toContain(undefined);
  });
  it('heat is a log scale against the busiest place and 0 means no coverage', () => {
    expect(heatOf(0, 10)).toBe(0);
    expect(heatOf(10, 10)).toBe(5);
    expect(heatOf(1, 10)).toBeGreaterThanOrEqual(1);
    expect(heatOf(1, 1)).toBe(3);
  });
  it('every placement is explained in words', () => {
    expect(basisLine(STORIES[0], (k) => k)).toBe('Placed because the story names “Kremlin”, “Kyiv”.');
    expect(basisLine(STORIES[2], (k) => k)).toMatch(/where the outlet is based \(Kenya\)\. The story itself names no place\./);
    expect(basisLine(STORIES[3], (k) => k)).toMatch(/^Not on the map/);
  });
});

describe('the map', () => {
  it('only countries with stories are buttons, each saying its count', () => {
    const { regions, arcs } = rollUp(STORIES, now);
    const onSelect = vi.fn();
    render(<WorldMap regions={regions} arcs={arcs} selected={null} onSelect={onSelect} />);
    const active = screen.getAllByTestId('sr-country-active');
    expect(active.map((e) => e.getAttribute('data-place')).sort()).toEqual(['Kenya', 'Russia', 'Ukraine']);
    expect(screen.getByRole('button', { name: 'Ukraine: 2 stories' })).toBeTruthy();
    fireEvent.keyDown(screen.getByRole('button', { name: 'Kenya: 1 story' }), { key: 'Enter' });
    expect(onSelect).toHaveBeenCalledWith('Kenya');
  });
});

describe('the dossier', () => {
  beforeEach(() => lensRun.mockReset());
  const dossier = (extra: Partial<Parameters<typeof Dossier>[0]> = {}) => {
    const { regions } = rollUp(STORIES, now);
    const props = { situation: {} as Situation, regions, stories: STORIES, selected: null, onSelect: vi.fn(), openStory: null, setOpenStory: vi.fn(), lib: {}, setLib: vi.fn(), notify: vi.fn(), ...extra };
    return render(<Dossier {...props} />);
  };
  it('sorts and filters the stories by outlet', () => {
    dossier();
    const titles = () => screen.getAllByTestId('sr-story').map((b) => b.querySelector('p')!.textContent);
    expect(titles()[0]).toBe('Kremlin says Kyiv talks stalled');
    fireEvent.change(screen.getByTestId('sr-sort'), { target: { value: 'oldest' } });
    expect(titles()[0]).toBe('Ukrainian grain exports rebound');
    fireEvent.change(screen.getByTestId('sr-source-filter'), { target: { value: 'Ledger' } });
    expect(titles()).toEqual(['Markets steady']);
  });
  it('a selected place shows its own numbers', () => {
    dossier({ selected: 'Ukraine' });
    expect(screen.getByTestId('sr-region-name').textContent).toBe('Ukraine');
    expect(within(screen.getByTestId('sr-region-stats')).getAllByText('2').length).toBeGreaterThan(0);
    expect(screen.getAllByTestId('sr-story')).toHaveLength(2);
  });
  it('unmeasurable bias is said in words; a measured 0 stays 0', async () => {
    lensRun.mockImplementation(async (_d: string, action: string) => {
      if (action === 'biasDetection') return env({ overallBiasScore: null, overallBiasReason: 'no_bias_terms', biasLevel: null, sourceDiversity: { uniqueSources: 1, assessment: 'concentrated' } });
      return env({});
    });
    const { unmount } = dossier({ openStory: STORIES[3] });
    fireEvent.click(screen.getByRole('button', { name: /^Weigh/ }));
    await waitFor(() => expect(screen.getByTestId('sr-bias').textContent).toMatch(/^Not available: no loaded or hedge words found in the text\. That is not the same as neutral\./));
    expect(screen.getByTestId('sr-bias').textContent).not.toMatch(/null|undefined|NaN|no_bias_terms/);
    unmount();
    lensRun.mockImplementation(async () => env({ overallBiasScore: 0, biasLevel: 'low', sourceDiversity: { uniqueSources: 1, assessment: 'concentrated' } }));
    dossier({ openStory: STORIES[3] });
    fireEvent.click(screen.getByRole('button', { name: /^Weigh/ }));
    await waitFor(() => expect(screen.getByTestId('sr-bias').textContent).toMatch(/Bias low \(0\)\./));
  });
  it('keeping a live story files it in the library with its own source, link and time', async () => {
    const live = story({ id: 'hl_1', kind: 'live', title: 'Floods in Manila', source: 'Pacific', url: 'https://x.example/a', places: [{ key: 'Philippines', terms: ['Manila'] }], basis: 'mentioned' });
    lensRun.mockImplementation(async (_d: string, action: string) => action === 'article-add' ? env({ article: { id: 'art_9' } }) : env({}));
    const setLib = vi.fn();
    dossier({ openStory: live, setLib });
    fireEvent.click(screen.getByTestId('sr-keep'));
    await waitFor(() => expect(setLib).toHaveBeenCalled());
    const add = lensRun.mock.calls.find((c) => c[1] === 'article-add')![2];
    expect(add).toEqual({ title: 'Floods in Manila', source: 'Pacific', url: 'https://x.example/a', publishedAt: live.at, topic: 'world' });
  });
});

describe('the room', () => {
  beforeEach(() => lensRun.mockReset());
  it('names a live-feed outage and shows the honest empty board', async () => {
    lensRun.mockResolvedValue(env({
      window: { hours: 24, from: at(24), to: at(0) },
      feed: { status: 'unavailable', reasons: ['upstream_error: DNS lookup failed'], fetchedAt: null, categories: {}, sources: [] },
      stories: [], regions: [], arcs: [], timeline: [{ at: at(1), count: 0, placed: 0 }],
      counts: { stories: 0, placed: 0, mentioned: 0, outlet: 0, unplaced: 0, undated: 0, live: 0, library: 0 },
    }));
    render(<SituationRoom />);
    await waitFor(() => expect(screen.getByTestId('sr-feed').textContent).toMatch(/Live feed unreachable — the news sources cannot be reached from this server\. Showing the library\./));
    expect(screen.getByTestId('sr-empty').textContent).toMatch(/Quiet board/);
    expect(lensRun).toHaveBeenCalledWith('news', 'situation', expect.objectContaining({ hours: 24 }));
  });
});
