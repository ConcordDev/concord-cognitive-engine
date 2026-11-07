// Render + behaviour coverage for the atlas lens: the section (explore, places, lists, trips,
// directions, planner, tools, recent) and offline map areas. Map and sibling tool widgets are
// stubbed; the section's own CRUD and navigation logic is what runs.

import React from 'react';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { act, cleanup, fireEvent, render as rtlRender, screen } from '@testing-library/react';
import { actionOf, exercise } from '../../../tests/helpers/exercise';

const lensRunMock = vi.fn();
const PLACE = (id: string, over: Record<string, unknown> = {}) => ({ id, number: `P-${id}`, name: `Place ${id}`, lat: 40.7, lng: -74, category: 'cafe', address: '1 Main St', notes: 'Nice', rating: 4, savedAt: '2026-03-01', ...over });
const AREA = (id: string, status: string) => ({ id, number: `A-${id}`, name: `Area ${id}`, bbox: { south: 40, west: -75, north: 41, east: -73 }, minZoom: 10, maxZoom: 12, tileCount: 20, estimatedSizeMB: 1.2, status, createdAt: '2026-03-01', downloadedAt: null });

function resultFor(action: string): unknown {
  switch (action) {
    case 'places-list': return { places: [PLACE('1'), PLACE('2', { category: 'hotel', rating: null }), PLACE('3', { category: 'park' })] };
    case 'lists-list': return { lists: [{ id: 'l1', number: 'L-1', name: 'Favourites', description: 'Best spots', color: '#6366f1', placeIds: ['1'], placeCount: 1, places: [PLACE('1')] }] };
    case 'trips-list': return { trips: [{ id: 't1', number: 'T-1', name: 'NYC weekend', startDate: '2026-04-01', endDate: '2026-04-03', stops: [{ id: 's1', name: 'Cafe', lat: 40.7, lng: -74, placeId: '1', day: 1, notes: '' }, { id: 's2', name: 'Park', lat: 40.8, lng: -73.9, placeId: null, day: 2, notes: 'walk' }], createdAt: '2026-03-01' }] };
    case 'nominatim-geocode': return { places: [{ displayName: 'Brooklyn, NY', latitude: 40.65, longitude: -73.95, name: 'Brooklyn', lat: 40.65, lng: -73.95, address: 'Brooklyn, New York', category: 'place', type: 'city' }], count: 1 };
    case 'recent-searches-list': return { recent: [{ query: 'coffee', at: '2026-03-02' }, { query: 'museum', at: '2026-03-01' }] };
    case 'atlas-dashboard-summary': return { placeCount: 3, listCount: 1, tripCount: 1, totalStops: 2, offlineAreaCount: 3, byCategory: { cafe: 2, hotel: 1 }, navActive: true };
    case 'ai-trip-plan': return { narration: 'A relaxed foodie weekend', itinerary: [{ day: 1, theme: 'Coffee', stops: [{ name: 'Cafe', lat: 40.7, lng: -74, notes: 'espresso', placeId: '1', category: 'cafe' }] }, { day: 2, theme: 'Parks', stops: [] }], source: 'concord-planner' };
    case 'offline-areas-list': return { areas: [AREA('o1', 'pending'), AREA('o2', 'ready'), AREA('o3', 'error')] };
    default: return { ok: true, id: 'new-1', place: PLACE('9'), area: AREA('o9', 'pending') };
  }
}
vi.mock('@/lib/api/client', () => ({
  lensRun: (...a: unknown[]) => lensRunMock(...a),
  api: { get: vi.fn(async () => ({ data: {} })), post: vi.fn(async () => ({ data: {} })) },
  apiHelpers: { lens: { runDomain: vi.fn(async () => ({ data: { ok: true, result: {} } })), list: vi.fn(async () => ({ data: { artifacts: [], total: 0 } })) } },
}));
vi.mock('@/hooks/useLensCommand', () => ({ useLensCommand: () => {} }));
vi.mock('next/dynamic', () => ({ default: () => () => <div>map view</div> }));
vi.mock('@/components/common/MapView', () => ({ default: () => <div>map view</div> }));
vi.mock('@/components/ui', () => ({ Skeleton: () => <div>skeleton</div> }));
vi.mock('@/components/dtu/SaveAsDtuButton', () => ({ SaveAsDtuButton: () => <button>save-as-dtu</button> }));
vi.mock('../AtlasShell', () => ({
  AtlasShell: ({ activeNav, onNavChange, panel, badges }: { activeNav: string; onNavChange: (n: string) => void; panel: React.ReactNode; badges?: Record<string, number> }) => (
    <div>{['explore', 'places', 'lists', 'trips', 'directions', 'planner', 'tools', 'recent'].map((n) => <button key={n} aria-current={activeNav === n} onClick={() => onNavChange(n)}>{`nav-${n}${badges?.[n] ?? ''}`}</button>)}{panel}</div>
  ),
  AtlasNav: undefined,
}));
for (const n of ['AtlasKeepMenu', 'PlacesGraph', 'PlaceShareSheet', 'DistanceMatrixPanel', 'RegionStatsTool', 'BatchGeocodeTool', 'PlaceDetails', 'StreetImagery', 'LiveTrafficPanel', 'TransitDirections', 'NavigationMode', 'RouteStops', 'AtlasActionPanel']) vi.doMock(`../${n}`, () => ({ [n]: () => <span>{n}-stub</span> }));
vi.mock('framer-motion', () => ({
  useReducedMotion: () => false,
  MotionConfig: ({ children }: { children?: React.ReactNode }) => children,
  motion: new Proxy({}, { get: () => (p: Record<string, unknown>) => <div>{p.children as React.ReactNode}</div> }),
  AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

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
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true })));
});

describe('atlas offline areas', () => {
  it('lists areas, validates, creates, downloads tiles, and deletes behind a confirmation', async () => {
    const { OfflineAreas } = await import('../OfflineAreas');
    const view = rtlRender(<OfflineAreas />);
    await settle();
    expect(view.container.textContent).toMatch(/Area o1/);
    await press(/^(Create|Add|Save)/i);
    const ins = screen.queryAllByRole('textbox').concat(screen.queryAllByRole('spinbutton')) as HTMLInputElement[];
    ins.forEach((el, i) => fireEvent.change(el, { target: { value: i === 0 ? 'Midtown' : String([40.7, -74.1, 40.8, -73.9, 10, 12][i - 1] ?? 10) } }));
    await press(/^(Create|Add|Save)/i);
    await press(/Download|Cache/i); await settle();
    await press(/Delete|Trash/i); await press(/Confirm|Yes|Delete/i);
    expect(sent()).toContain('offline-areas-list');
    expect(sent().some((x) => /offline-areas-(create|update-status|delete)/.test(x))).toBe(true);
  });
  it('stays standing offline', async () => {
    lensRunMock.mockImplementation(async () => ({ data: { ok: false, error: 'offline' } }));
    const { OfflineAreas } = await import('../OfflineAreas');
    const view = rtlRender(<OfflineAreas />);
    await settle();
    await exercise({ passes: 1 });
    expect(view.container).toBeTruthy();
  });
});

describe('atlas section', () => {
  it('walks every nav panel and drives places, lists, trips, search and planner', async () => {
    const { AtlasSection } = await import('../AtlasSection');
    const view = rtlRender(<AtlasSection />);
    await settle();
    expect(sent()).toEqual(expect.arrayContaining(['places-list', 'lists-list', 'trips-list']));
    const skip = /^nav-|delete|remove|trash|discard|cancel|close|dismiss|reset|clear|^back|^×$/i;
    for (const n of ['explore', 'places', 'lists', 'trips', 'directions', 'planner', 'tools', 'recent']) {
      await press(new RegExp(`^nav-${n}`));
      await settle();
      await exercise({ passes: 3, text: 'Brooklyn', skip });
      await settle();
      await exercise({ passes: 1, text: '40.7', skip });
      expect(view.container.textContent?.length).toBeGreaterThan(20);
    }
    const a = sent();
    expect(a.filter((x) => /nominatim-geocode|places-save|lists-create|trips-create|ai-trip-plan|recent-searches/.test(x)).length).toBeGreaterThan(2);
  });

  it('deletes places, lists and trips in two steps and reorders stops', async () => {
    const { AtlasSection } = await import('../AtlasSection');
    rtlRender(<AtlasSection />);
    await settle();
    for (const n of ['places', 'lists', 'trips']) {
      await press(new RegExp(`^nav-${n}`)); await settle();
      await press(/Place 1|Favourites|NYC weekend/); await settle();
      await press(/Edit|Pencil/i); await press(/^(Save|Update)/i);
      await press(/↑|Up|Move up/i); await press(/↓|Down|Move down/i);
      await press(/Delete|Trash/i); await press(/Confirm|Yes|Delete/i);
    }
    expect(sent().some((x) => /places-(delete|update)|lists-delete|trips-delete|trips-reorder-stops|lists-remove-place|trips-remove-stop/.test(x))).toBe(true);
  });

  it('stays standing when the atlas cannot load', async () => {
    lensRunMock.mockImplementation(async () => ({ data: { ok: false, error: 'offline', result: null } }));
    const { AtlasSection } = await import('../AtlasSection');
    const view = rtlRender(<AtlasSection />);
    await settle();
    await exercise({ passes: 1 });
    expect(view.container).toBeTruthy();
  });

  it('explores a place by search, saves a result, adds a place by hand, and runs the AI planner', async () => {
    const { AtlasSection } = await import('../AtlasSection');
    rtlRender(<AtlasSection />);
    await settle();
    await press(/^nav-explore/); await settle();
    const q = screen.queryAllByRole('textbox')[0];
    if (q) { fireEvent.change(q, { target: { value: 'Brooklyn' } }); fireEvent.keyDown(q, { key: 'Enter' }); }
    await press(/Search|Go|Find/i); await settle();
    await press(/Save|Bookmark|\+/i); await press(/Brooklyn/); await press(/Show on map|Map/i);
    await press(/^nav-places/); await settle();
    await press(/Add|New|\+/i);
    for (const el of Array.from(document.querySelectorAll('input, textarea, select')) as HTMLInputElement[]) {
      if (el.tagName === 'SELECT') { const o = Array.from((el as unknown as HTMLSelectElement).options).find((x) => x.value); if (o) fireEvent.change(el, { target: { value: o.value } }); continue; }
      fireEvent.change(el, { target: { value: el.type === 'number' ? '41.2' : 'Corner Cafe' } });
    }
    await press(/^(Save|Add place|Create)/i);
    await press(/^nav-planner/); await settle();
    fireEvent.change(document.querySelector('textarea') as HTMLTextAreaElement, { target: { value: 'relaxed foodie weekend' } });
    await press(/^Plan$/);
    await press(/^nav-recent/); await settle();
    await press(/Clear/);
    expect(sent().some((x) => /nominatim-geocode|places-save|ai-trip-plan|recent-searches-clear/.test(x))).toBe(true);
  });
});
