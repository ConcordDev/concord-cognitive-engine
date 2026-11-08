// Behaviour coverage for the urban-planning scenario studio (create / compare / remove / load
// failure retry) and the zoning + site-analysis calculators (all five tools, success + failure).

import React from 'react';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { actionOf, exercise } from '../../../tests/helpers/exercise';

const lensRunMock = vi.fn();
const MASSING = (n: number) => ({ zoneType: 'mixed', lotSizeSqFt: 20000, floorAreaRatio: 3, derivedFar: n === 2 ? null : 2.9, lotCoveragePct: 55, footprintSqFt: 11000, floors: 6 + n, buildingHeightFt: 70, maxHeightFt: 85, setbackFt: 10, grossFloorAreaSqFt: 60000 + n, netFloorAreaSqFt: 49000, dwellingUnits: 40 + n, jobs: 120, population: 90, emissionsTonnesPerYear: 310 + n, envelope: { widthFt: 100, depthFt: 110, heightFt: 70 } });
const SCENARIOS = [
  { id: 's1', name: 'Mixed core', description: 'Dense', zoneType: 'mixed', lotSizeSqFt: 20000, useMix: 'mixed', efficiency: 0.82, impacts: MASSING(1) },
  { id: 's2', name: 'Residential infill', description: '', zoneType: 'residential', lotSizeSqFt: 8000, useMix: 'residential', efficiency: 0.8, impacts: MASSING(2) },
  { id: 's3', name: 'No impacts', description: '', zoneType: 'industrial', lotSizeSqFt: 9000, useMix: 'industrial', efficiency: 0.7 },
];
const SAMPLES = Array.from({ length: 24 }, (_, i) => ({ hourUtc: i, sunUp: i >= 6 && i <= 18, altitudeDeg: i >= 6 && i <= 18 ? 40 : -10, azimuthDeg: i * 15, shadowLengthFt: i >= 6 && i <= 18 ? 80 : null, shadowDirectionDeg: i >= 6 && i <= 18 ? 270 : null }));
function resultFor(action: string): unknown {
  switch (action) {
    case 'scenario-list': return { scenarios: SCENARIOS };
    case 'scenario-compare': return { count: 2, metrics: ['dwellingUnits', 'jobs', 'emissionsTonnesPerYear'], scenarios: [{ id: 's1', name: 'Mixed core', ...MASSING(1) }, { id: 's2', name: 'Residential infill', ...MASSING(2) }], totals: { dwellingUnits: 81, jobs: 240, emissionsTonnesPerYear: 623 }, best: { dwellingUnits: 's1', jobs: 's2', emissionsTonnesPerYear: 's2' } };
    case 'zoningAnalysis': return { zoneType: 'residential', lotSize: 5000, floorAreaRatio: 0.6, maxBuildableSqFt: 3000, maxHeight: '35 ft', setback: '20 ft', parkingRequired: '2 per unit', density: 'low' };
    case 'walkabilityScore': return { walkabilityScore: 72, rating: 'Very walkable', amenityScores: { grocery: 90, park: 60 }, totalAmenities: 2 };
    case 'densityCalc': return { population: 12000, area: '3 km²', populationDensity: '4000/km²', housingDensity: '1500/km²', classification: 'suburban', transitViability: 'moderate' };
    case 'trafficImpact': return { newDailyTrips: 540, housingTrips: 400, commercialTrips: 140, tripsPerHousingUnit: 9.4, tripsPerCommercialSqFt: 0.02, rateBasis: 'ITE 11th ed.', peakHourTrips: 54, currentADT: 8000, percentIncrease: 6.8, impactLevel: 'moderate', mitigation: ['Add turn lane', 'Signal retiming'] };
    case 'shadowStudy': return { label: '2D shadow path', location: { lat: 40.7, lng: -74, source: 'input' }, date: '2026-06-21', envelope: { widthFt: 100, depthFt: 100, heightFt: 80 }, method: 'NOAA solar position', resolution: 'hourly', samples: SAMPLES, daylightHours: 13, approxSolarNoon: { hourUtc: 17, altitudeDeg: 72, note: 'approx' } };
    default: return { ok: true };
  }
}
vi.mock('@/lib/api/client', () => ({ lensRun: (...a: unknown[]) => lensRunMock(...a) }));
vi.mock('@/components/viz', () => ({ ChartKit: ({ data }: { data?: unknown[] }) => <div>chart:{data?.length ?? 0}</div> }));

const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 30)); });
const sent = () => lensRunMock.mock.calls.map((c) => actionOf(c));
const click = async (el: Element) => { await act(async () => { fireEvent.click(el); await new Promise((r) => setTimeout(r, 25)); }); };
const btn = (re: RegExp, nth = 0) => screen.getAllByRole('button', { name: re })[nth];
afterEach(() => cleanup());
beforeEach(() => {
  lensRunMock.mockReset();
  lensRunMock.mockImplementation(async (...a: unknown[]) => ({ data: { ok: true, result: resultFor(actionOf(a)) } }));
});

describe('ScenarioStudio', () => {
  const mount = async (props: Record<string, unknown> = {}) => { const { ScenarioStudio } = await import('../ScenarioStudio'); const v = render(<ScenarioStudio {...props} />); await settle(); return v; };

  it('lists scenarios with massing, validates + creates, compares and removes', async () => {
    const changed = vi.fn();
    const v = await mount({ onDataChanged: changed });
    expect(v.container.textContent).toMatch(/Mixed core/);
    expect(v.container.textContent).toMatch(/Residential infill/);
    await click(btn(/Add Scenario/));
    expect(v.container.textContent).toMatch(/scenario name required/);
    await act(async () => { fireEvent.change(screen.getByPlaceholderText('Scenario name'), { target: { value: 'Tower' } }); });
    await act(async () => { fireEvent.change(screen.getByPlaceholderText(/Description/), { target: { value: 'tall' } }); });
    const selects = v.container.querySelectorAll('select');
    await act(async () => { fireEvent.change(selects[0], { target: { value: 'commercial' } }); });
    await act(async () => { fireEvent.change(selects[1], { target: { value: 'residential' } }); });
    await act(async () => { fireEvent.change(screen.getByPlaceholderText(/Lot size/), { target: { value: '30000' } }); });
    await act(async () => { fireEvent.change(screen.getByPlaceholderText(/Floor efficiency/), { target: { value: '0.9' } }); });
    await click(btn(/Add Scenario/));
    expect(sent()).toContain('scenario-create');
    expect(changed).toHaveBeenCalled();
    await click(btn(/Compare All/));
    expect(v.container.textContent).toMatch(/Scenario Comparison \(2\)/);
    expect(v.container.textContent).toMatch(/Dwelling units/);
    await click(screen.getAllByLabelText('Delete scenario')[0]);
    expect(sent()).toContain('scenario-remove');
    await click(screen.getByLabelText('Refresh scenarios'));
  });

  it('reports create and compare failures', async () => {
    const v = await mount();
    lensRunMock.mockImplementation(async (...a: unknown[]) => ['scenario-create', 'scenario-compare'].includes(actionOf(a)) ? { data: { ok: false, error: 'refused' } } : { data: { ok: true, result: resultFor(actionOf(a)) } });
    await act(async () => { fireEvent.change(screen.getByPlaceholderText('Scenario name'), { target: { value: 'X' } }); });
    await click(btn(/Add Scenario/));
    expect(v.container.textContent).toMatch(/refused/);
    await click(btn(/Compare All/));
    expect(v.container.textContent).toMatch(/refused/);
    lensRunMock.mockImplementation(async (...a: unknown[]) => actionOf(a) === 'scenario-compare' ? { data: { ok: false } } : { data: { ok: true, result: resultFor(actionOf(a)) } });
    await click(btn(/Compare All/));
    expect(v.container.textContent).toMatch(/comparison needs at least one scenario/);
  });

  it('shows empty, load-failure with retry, and thrown-error states', async () => {
    lensRunMock.mockImplementation(async () => ({ data: { ok: true, result: { scenarios: [] } } }));
    const empty = await mount();
    expect(empty.container.textContent).toMatch(/No scenarios yet/);
    cleanup();
    lensRunMock.mockImplementation(async () => ({ data: { ok: false } }));
    const bad = await mount();
    expect(bad.container.textContent).toMatch(/failed to load scenarios/);
    lensRunMock.mockImplementation(async (...a: unknown[]) => ({ data: { ok: true, result: resultFor(actionOf(a)) } }));
    await click(btn(/Retry/));
    expect(bad.container.textContent).toMatch(/Mixed core/);
    cleanup();
    lensRunMock.mockRejectedValue(new Error('net down'));
    const thrown = await mount();
    expect(thrown.container.textContent).toMatch(/net down/);
  });
});

describe('ZoningSiteAnalysis', () => {
  const mount = async () => { const { ZoningSiteAnalysis } = await import('../ZoningSiteAnalysis'); const v = render(<ZoningSiteAnalysis />); await settle(); return v; };
  const TOOL_RE = /^(Zoning Analysis|Walkability Score|Density Calculator|Traffic Impact|Sun \/ Shadow Study)$/;

  it('runs every calculator and renders its numbers', { timeout: 120000 }, async () => {
    const v = await mount();
    for (const t of ['Zoning Analysis', 'Walkability Score', 'Density Calculator', 'Traffic Impact', 'Sun / Shadow Study']) {
      const tab = screen.getAllByRole('button').find((b) => (b.textContent || '').trim() === t) as HTMLElement;
      await click(tab);
      await exercise({ passes: 2, text: '12', skip: new RegExp(`${TOOL_RE.source}|delete|remove|trash|cancel|close|^×$`, 'i') });
      await settle();
    }
    const calls = sent();
    for (const a of ['zoningAnalysis', 'walkabilityScore', 'densityCalc', 'trafficImpact', 'shadowStudy']) expect(calls).toContain(a);
    expect(v.container.textContent?.length).toBeGreaterThan(100);
  });

  it('surfaces backend failures for every calculator', { timeout: 120000 }, async () => {
    lensRunMock.mockImplementation(async () => ({ data: { ok: false, error: 'calc offline' } }));
    const v = await mount();
    for (const t of ['Zoning Analysis', 'Walkability Score', 'Density Calculator', 'Traffic Impact', 'Sun / Shadow Study']) {
      const tab = screen.getAllByRole('button').find((b) => (b.textContent || '').trim() === t) as HTMLElement;
      await click(tab);
      await exercise({ passes: 1, text: '7', skip: new RegExp(`${TOOL_RE.source}|delete|remove|cancel|close|^×$`, 'i') });
    }
    expect(v.container.textContent).toMatch(/calc offline/);
  });
});
