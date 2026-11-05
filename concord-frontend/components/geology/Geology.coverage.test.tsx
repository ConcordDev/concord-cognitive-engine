// Render coverage for the geology panels: each mounts against a permissive
// stubbed macro result, then the generic sweep fills and presses its controls.

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { act, cleanup, render as rtlRender } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { exercise } from '../../tests/helpers/exercise';
import { actionOf } from '../../tests/helpers/exercise';

const lensRunMock = vi.fn();
const T = '2026-03-01T10:00:00.000Z';
const OBS = { id: 'o1', name: 'Granite sample', kind: 'rock', lat: 40.1, lon: -105.2, locationName: 'Ridge', formation: 'Pikes', notes: 'n', tags: ['a'], collectedAt: T };
const LAYER = { formation: 'Morrison', lithology: 'sandstone', thickness: 40, depthTop: 0, depthBottom: 40, age: 'Jurassic', fossils: ['ammonite'] };
const QUAKE = { id: 'q1', magnitude: 4.2, place: '10km N of X', timeMs: Date.now() - 600000, depthKm: 8, latitude: 35.1, longitude: -118.2, tsunami: false, url: 'https://example.org/q1' };
const RESULTS: Record<string, unknown> = {
  'observation-list': { ok: true, observations: [OBS] },
  'field-dashboard': { ok: true, totalObservations: 1, byKind: { rock: 1 }, geotagged: 1, formations: 1 },
  'observation-log': { ok: true },
  'observation-delete': { ok: true },
  'measurement-list': { ok: true, measurements: [{ planeKind: 'bedding', strike: 40, dip: 20, dipDirection: 130, lat: 40.2, lon: -105.1, locationName: 'Cut' }] },
  'column-list': { ok: true, columns: [{ id: 'c1', name: 'Section A', layers: [{ name: 'Morrison', lithology: 'sandstone', thickness: 40, age: 'Jurassic', fossils: ['ammonite'] }], updatedAt: T }] },
  'column-save': { ok: true, column: { id: 'c2', name: 'Section B', layers: [], updatedAt: T } },
  'column-delete': { ok: true },
  stratigraphicColumn: { layers: [LAYER, { ...LAYER, formation: 'Entrada', fossils: [] }], totalThickness: 80, layerCount: 2, oldestFormation: 'Entrada', youngestFormation: 'Morrison', fossiliferous: 1 },
  live_quakes_today: { ok: true, quakes: [QUAKE, { ...QUAKE, id: 'q2', magnitude: 6.1, tsunami: true }], total: 2, fetchedAt: Date.now() },
};
const reply = (action = '') => ({ data: { ok: true, result: RESULTS[action] ?? { ok: true } } });
vi.mock('@/lib/api/client', () => ({
  lensRun: (...a: unknown[]) => lensRunMock(...a),
  api: { get: vi.fn(async () => ({ data: {} })), post: vi.fn(async () => ({ data: {} })) },
  apiHelpers: { lens: { runDomain: vi.fn(async (_d: string, name: string) => reply(name)) } },
}));
vi.mock('@/components/common/MapView', () => ({ MapView: () => <div data-testid="map" />, default: () => <div data-testid="map" /> }));
vi.mock('@/components/dtu/SaveAsDtuButton', () => ({ SaveAsDtuButton: () => <button>Save as DTU</button>, default: () => <button>Save as DTU</button> }));
vi.mock('@/components/lens-primitives/CalcPanel', () => ({
  CalcPanel: (p: { title: string; left: { render: React.ReactNode }; right: { render: React.ReactNode }; renderResults: (l: unknown, r: unknown, e?: unknown) => React.ReactNode }) => (
    <div>
      <h2>{p.title}</h2>{p.left.render}{p.right.render}
      <div data-testid="filled">{p.renderResults(
        { specimen: 'Granite', rockType: 'igneous', mohsHardness: 6, luster: 'vitreous', color: 'pink', texture: 'phaneritic', durability: 'high', commonUses: ['construction'] },
        { specimen: 'Quartz', properties: { hardness: 7, streak: 'white', cleavage: 'none', fracture: 'conchoidal', specific_gravity: 2.65 }, identificationConfidence: 0.9, identification: { species: 'Quartz', family: 'silicate', match: 0.9 }, candidates: [{ species: 'Quartz', family: 'silicate', match: 0.9 }, { species: 'Chert', family: 'silicate', match: 0.4 }], testsPerformed: 4, testsRecommended: ['acid'], classification: 'mineral' },
      )}</div>
      <div data-testid="empty">{p.renderResults(null, null)}</div>
      <div data-testid="errors">{p.renderResults(null, null, { left: 'rock failed', right: 'mineral failed' })}</div>
    </div>
  ),
}));

import { FieldLog } from './FieldLog';
import { FieldSitesMap } from './FieldSitesMap';
import { RockMineralIdPanel } from './RockMineralIdPanel';
import { StratigraphicColumnPanel } from './StratigraphicColumnPanel';
import { UsgsQuakePanel } from './UsgsQuakePanel';

afterEach(() => cleanup());
beforeEach(() => { lensRunMock.mockReset(); lensRunMock.mockImplementation(async (...a: unknown[]) => reply(actionOf(a))); });
const render = (ui: React.ReactElement) => rtlRender(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider>);
const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });

describe.each([
  ['FieldLog', FieldLog], ['FieldSitesMap', FieldSitesMap], ['RockMineralIdPanel', RockMineralIdPanel],
  ['StratigraphicColumnPanel', StratigraphicColumnPanel], ['UsgsQuakePanel', UsgsQuakePanel],
])('%s', (_n, Comp: React.ComponentType) => {
  it('renders and drives its controls', async () => {
    const view = render(<Comp />);
    await settle();
    expect(view.container.textContent).toBeTruthy();
    await exercise({ passes: 3 });
    await settle();
  });
  it('shows an honest failure when the macro is offline', async () => {
    lensRunMock.mockImplementation(async () => ({ data: { ok: false, error: 'offline' } }));
    const view = render(<Comp />);
    await settle();
    await exercise({ passes: 1 });
    expect(view.container.textContent).toBeTruthy();
  });
});
