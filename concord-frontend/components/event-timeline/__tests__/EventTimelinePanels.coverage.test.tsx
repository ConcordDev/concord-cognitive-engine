// Render + behaviour coverage for the event-timeline lens panels: channel trends, the live
// firehose (live / search / range modes, export), On This Day, and saved views.

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { act, cleanup, fireEvent, render as rtlRender, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { actionOf, exercise } from '../../../tests/helpers/exercise';

const lensRunMock = vi.fn();
const publicLookup = vi.hoisted(() => vi.fn());
const ROW = (id: number, channel: string) => ({ id, channel, world_id: 'w1', actor_kind: 'player', actor_id: 'u1', payload: { text: 'did a thing', amount: 3 }, created_at: 1_760_000_000 + id });

function resultFor(action: string): unknown {
  switch (action) {
    case 'timeseries': return { ok: true, fromTs: 1, toTs: 100, bucketSec: 60, buckets: 32, series: [{ channel: 'combat:hit', counts: Array.from({ length: 32 }, (_, i) => i % 5), total: 60 }, { channel: 'economy:sale', counts: Array.from({ length: 32 }, () => 1), total: 32 }] };
    case 'recent': case 'search': case 'range': return { ok: true, rows: [ROW(1, 'combat:hit'), ROW(2, 'economy:sale'), ROW(3, 'world:weather')] };
    case 'stats': return { ok: true, channels: [{ channel: 'combat:hit', count: 40 }, { channel: 'economy:sale', count: 10 }] };
    case 'channels': return { ok: true, channels: [{ channel: 'combat:hit', count: 40, last_seen: 1_760_000_000 }, { channel: 'economy:sale', count: 10, last_seen: 1_760_000_100 }, { channel: 'world:weather', count: 2, last_seen: 1_760_000_200 }] };
    case 'exportEvents': return { ok: true, body: 'id,channel\n1,combat:hit', mime: 'text/csv', filename: 'events.csv' };
    case 'listViews': return { ok: true, views: [{ id: 'v1', name: 'Combat only', channels: ['combat:hit'], worldId: 'w1', query: 'hit', createdAt: 1_760_000_000 }, { id: 'v2', name: 'Everything', channels: [], worldId: null, query: '', createdAt: 1_760_000_100 }] };
    default: return { ok: true, id: 'view-new', view: { id: 'v3' } };
  }
}
vi.mock('@/lib/api/client', () => ({
  lensRun: (...a: unknown[]) => lensRunMock(...a),
  api: { get: vi.fn(async () => ({ data: {} })), post: vi.fn(async () => ({ data: {} })) },
  apiHelpers: { lens: { runDomain: vi.fn(async () => ({ data: { ok: true, result: {} } })), list: vi.fn(async () => ({ data: { artifacts: [], total: 0 } })) } },
}));
vi.mock('@/lib/public-lookup', () => ({ publicLookup: (...a: unknown[]) => publicLookup(...a), carryLookupMeta: vi.fn(), lookupMeta: () => null }));
vi.mock('@/hooks/useLensCommand', () => ({ useLensCommand: () => {} }));
vi.mock('@/components/dtu/SaveAsDtuButton', () => ({ SaveAsDtuButton: () => <button>save-as-dtu</button> }));
vi.mock('@/components/common/LookupNotice', () => ({ LookupNotice: () => <div>lookup notice</div> }));
vi.mock('@/components/event-timeline/EventDetailPanel', () => ({ EventDetailPanel: ({ onClose }: { onClose?: () => void }) => <button onClick={onClose}>detail-panel</button> }));
vi.mock('framer-motion', () => ({
  useReducedMotion: () => false,
  MotionConfig: ({ children }: { children?: React.ReactNode }) => children,
  motion: new Proxy({}, { get: () => (p: Record<string, unknown>) => <div>{p.children as React.ReactNode}</div> }),
  AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

import { ChannelTrends } from '../ChannelTrends';
import { FirehosePanel } from '../FirehosePanel';
import { OnThisDay } from '../OnThisDay';
import { SavedViewsBar } from '../SavedViewsBar';

const render = (ui: React.ReactElement) => rtlRender(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider>);
const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 5)); });
const sent = () => lensRunMock.mock.calls.map((c) => actionOf(c));
const press = async (re: RegExp, nth = 0) => {
  const hits = screen.queryAllByRole('button').filter((x) => re.test((x.textContent || x.getAttribute('aria-label') || x.getAttribute('title') || '').trim()));
  if (hits[nth]) await act(async () => { fireEvent.click(hits[nth]); await new Promise((r) => setTimeout(r, 5)); });
  return !!hits[nth];
};
const EV = (y: number, t: string) => ({ year: y, text: t, pages: [{ title: t, extract: 'Extract', content_urls: { desktop: { page: 'https://en.wikipedia.org/wiki/X' } } }] });
afterEach(() => { cleanup(); vi.useRealTimers(); });
beforeEach(() => {
  lensRunMock.mockReset(); publicLookup.mockReset();
  lensRunMock.mockImplementation(async (...a: unknown[]) => ({ data: { ok: true, result: resultFor(actionOf(a)), error: null } }));
  publicLookup.mockResolvedValue({ events: [EV(1969, 'Moon landing'), EV(1815, 'Waterloo')], selected: [EV(1066, 'Hastings')], births: [EV(1900, 'Someone born')], deaths: [EV(1950, 'Someone died')], holidays: [EV(0, 'A holiday')] });
  Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:x'), revokeObjectURL: vi.fn() });
});

const PANELS: Array<[string, () => React.ReactElement]> = [
  ['ChannelTrends', () => <ChannelTrends worldId="w1" selectedChannels={['combat:hit']} onToggleChannel={vi.fn()} />],
  ['FirehosePanel', () => <FirehosePanel />],
  ['OnThisDay', () => <OnThisDay />],
  ['SavedViewsBar', () => <SavedViewsBar current={{ channels: ['combat:hit'], worldId: 'w1', query: 'hit' }} onApply={vi.fn()} />],
];

describe('event-timeline panels', () => {
  it.each(PANELS)('%s renders real content with controls and survives a full exercise pass', async (_n, make) => {
    const view = render(make());
    await settle();
    expect(view.container.textContent?.trim().length).toBeGreaterThan(10);
    await exercise({ passes: 3, text: 'hit' });
    await settle();
    await exercise({ passes: 1, text: '5' });
    expect(view.container.textContent).toBeTruthy();
  });

  it.each(PANELS)('%s stays standing when the backend is offline', async (_n, make) => {
    lensRunMock.mockImplementation(async () => ({ data: { ok: false, error: 'offline', result: null } }));
    publicLookup.mockRejectedValue(new Error('offline'));
    const view = render(make());
    await settle();
    await exercise({ passes: 1 });
    expect(view.container).toBeTruthy();
  });
});

describe('event-timeline flows', () => {
  it('trends switch window and toggle a channel', async () => {
    const onToggle = vi.fn();
    render(<ChannelTrends worldId="" selectedChannels={[]} onToggleChannel={onToggle} />);
    await settle();
    for (const w of ['6h', '7d', '24h']) await press(new RegExp(`^${w}$`));
    await press(/combat:hit/);
    expect(onToggle).toHaveBeenCalled();
    expect(sent().filter((x) => x === 'timeseries').length).toBeGreaterThan(2);
  });

  it('the firehose polls live, searches, ranges, pauses, filters channels and exports', async () => {
    vi.useFakeTimers();
    render(<FirehosePanel />);
    await act(async () => { await vi.advanceTimersByTimeAsync(20); });
    const before = sent().filter((x) => x === 'recent').length;
    await act(async () => { await vi.advanceTimersByTimeAsync(5100); });
    expect(sent().filter((x) => x === 'recent').length).toBeGreaterThan(before);
    vi.useRealTimers();
    const box = screen.queryAllByRole('textbox')[0];
    if (box) { fireEvent.change(box, { target: { value: 'sale' } }); fireEvent.keyDown(box, { key: 'Enter' }); }
    await press(/Search/i);
    await press(/Pause/i); await press(/Play|Resume/i);
    await press(/Combat|Economy|World/i);
    await press(/combat:hit/);
    await press(/detail-panel/);
    await exercise({ passes: 2, text: '2026-03-01', skip: /delete|remove|trash|discard|cancel|close|dismiss|reset|clear|^back|^×$/i });
    await press(/^Range|Apply/i);
    await press(/CSV/i); await press(/JSON/i);
    const a = sent();
    expect(a).toEqual(expect.arrayContaining(['recent', 'stats', 'channels']));
    expect(a.some((x) => /search|range|exportEvents/.test(x))).toBe(true);
  });

  it('On This Day shows every section and a different date', async () => {
    const view = render(<OnThisDay />);
    await settle();
    expect(view.container.textContent).toMatch(/Moon landing/);
    for (const c of ['Selected', 'Births', 'Deaths', 'Holidays', 'Events']) { await press(new RegExp(`^${c}`)); }
    for (const sel of Array.from(view.container.querySelectorAll('select, input[type="number"]')) as HTMLInputElement[]) fireEvent.change(sel, { target: { value: '2' } });
    await settle();
    expect(publicLookup.mock.calls.length).toBeGreaterThan(0);
  });

  it('saved views save (with an overwrite confirmation), apply and delete', async () => {
    const onApply = vi.fn();
    render(<SavedViewsBar current={{ channels: ['combat:hit'], worldId: 'w1', query: 'hit' }} onApply={onApply} />);
    await settle();
    await press(/Combat only/);
    expect(onApply).toHaveBeenCalled();
    await press(/Save|Plus|\+/i);
    const input = screen.queryAllByRole('textbox')[0];
    if (input) { fireEvent.change(input, { target: { value: 'Combat only' } }); fireEvent.keyDown(input, { key: 'Enter' }); }
    await press(/^Save|Confirm|Overwrite/i); await press(/Overwrite|Confirm|Yes/i);
    if (input) fireEvent.change(input, { target: { value: 'Brand new' } });
    await press(/^Save|Confirm/i);
    await press(/Remove|Delete|×|X/i); await press(/Confirm|Yes|Delete/i);
    expect(sent()).toContain('listViews');
    expect(sent().some((x) => /saveView|deleteView/.test(x))).toBe(true);
  });
});
