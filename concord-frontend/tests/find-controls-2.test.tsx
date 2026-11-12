/**
 * find-controls-2.test.tsx — CB-0466 (audit sweep, missing find controls).
 *
 *  - FIX-astronomy-009: the sky-chart workbench gains a Clear control for
 *    the observer location (state + persisted copy both cleared).
 *  - FIX-worldmodel-004: the entity list gains search (name/type) and
 *    sort (name / value).
 *  - FIX-world-observatory-007: the worlds grid gains search; the world
 *    detail gains faction and district filters.
 *  - FIX-welding-010: the WPS and PQR record lists gain search (the
 *    lens's clause search never covered records).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

const lensRunMock = vi.fn();
vi.mock('@/lib/api/client', () => ({
  lensRun: (...args: unknown[]) => lensRunMock(...args),
  api: {
    post: async () => ({ ok: true, result: {} }),
    get: async () => ({ ok: true, result: {} }),
    delete: async () => ({ ok: true }),
  },
}));
vi.mock('@/components/viz', () => ({ ChartKit: () => null }));
vi.mock('@/components/viz/ChartKit', () => ({ ChartKit: () => null }));
vi.mock('@/components/dtu/DTUPickerModal', () => ({ DTUPickerModal: () => null }));
vi.mock('@/components/lens/LensShell', () => ({
  LensShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock('@/components/lens/DepthBadge', () => ({ DepthBadge: () => null }));
vi.mock('@/components/lens/ManifestActionBar', () => ({ ManifestActionBar: () => null }));
vi.mock('@/hooks/useLensCommand', () => ({ useLensCommand: () => {} }));
vi.mock('@/hooks/useLensNav', () => ({ useLensNav: () => {} }));
vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({ user: null, isLoading: false, isAuthenticated: false }),
}));
vi.mock('@/components/dtu/SaveAsDtuButton', () => ({
  SaveAsDtuButton: ({ title }: { title: string }) => (
    <button type="button">{`Save as DTU: ${title}`}</button>
  ),
}));

import { SkyChartWorkbench } from '@/components/astronomy/SkyChartWorkbench';
import { EntitiesPanel } from '@/components/worldmodel/EntitiesPanel';
import { WeldingOperations } from '@/components/welding/WeldingOperations';
import WorldObservatoryPage from '@/app/lenses/world-observatory/page';

function envelope(result: unknown) {
  return { data: { ok: true, result, error: null } };
}

function wrap(node: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{node}</QueryClientProvider>);
}

beforeEach(() => {
  lensRunMock.mockReset();
  lensRunMock.mockImplementation(async () => envelope({}));
  localStorage.clear();
});

afterEach(() => cleanup());

// ── FIX-astronomy-009 ──────────────────────────────────────────────────────

describe('FIX-astronomy-009 — clear observer location', () => {
  beforeEach(() => {
    lensRunMock.mockImplementation(async (_d: unknown, action: string) => {
      if (action === 'sky-chart') {
        return envelope({
          observer: { latitude: 41.7, longitude: -73.9 }, when: '2026-03-01T12:00:00Z', siderealTimeDeg: 42,
          sun: { altitude: 20, azimuth: 180, isDaytime: true },
          moon: { altitude: -5, azimuth: 90, illumination: 0.5, phase: 'waxing', visible: false },
          stars: [], constellationLines: [], visibleCount: 0,
        });
      }
      return envelope({});
    });
  });

  it('clears the observer from state and storage', async () => {
    localStorage.setItem('astronomy:observer', JSON.stringify({ latitude: 41.7, longitude: -73.9 }));
    render(<SkyChartWorkbench />);
    await screen.findByText(/Observing from 41\.7000°, -73\.9000°/);
    fireEvent.click(screen.getByLabelText('Clear observer location'));
    await waitFor(() => expect(screen.queryByText(/Observing from/)).toBeNull());
    expect(localStorage.getItem('astronomy:observer')).toBeNull();
  });
});

// ── FIX-worldmodel-004 ─────────────────────────────────────────────────────

describe('FIX-worldmodel-004 — entity search + sort', () => {
  beforeEach(() => {
    lensRunMock.mockImplementation(async (_d: unknown, action: string) => {
      if (action === 'wm_list_entities') {
        return envelope({
          entities: [
            { id: 'e1', name: 'Zeta', type: 'concept', attributes: { value: 5 } },
            { id: 'e2', name: 'Alpha', type: 'place', attributes: { value: 50 } },
          ],
        });
      }
      if (action === 'list_entity_types') return envelope({ types: [] });
      if (action === 'wm_list_relations') return envelope({ relations: [] });
      return envelope({});
    });
  });

  it('sorts entities by value and finds them by search', async () => {
    const { container } = wrap(<EntitiesPanel />);
    await screen.findByText('Zeta');
    // Default: name A–Z.
    expect(container.textContent!.indexOf('Alpha')).toBeLessThan(container.textContent!.indexOf('Zeta'));
    fireEvent.change(screen.getByLabelText('Sort entities'), { target: { value: 'value-asc' } });
    await waitFor(() => {
      expect(container.textContent!.indexOf('Zeta')).toBeLessThan(container.textContent!.indexOf('Alpha'));
    });
    fireEvent.change(screen.getByLabelText('Search entities'), { target: { value: 'place' } });
    await waitFor(() => expect(screen.queryByText('Zeta')).toBeNull());
    expect(screen.getByText('Alpha')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Search entities'), { target: { value: 'zzz-no-match' } });
    await screen.findByText('No entities match your search.');
  });
});

// ── FIX-welding-010 ────────────────────────────────────────────────────────

describe('FIX-welding-010 — WPS/PQR record search', () => {
  beforeEach(() => {
    lensRunMock.mockImplementation(async (_d: unknown, action: string) => {
      if (action === 'wps-list') {
        return envelope({
          wps: [
            { id: 'w1', wpsNumber: 'WPS-1', process: 'SMAW', baseMetal: 'A36', jointDesign: 'V-groove', positions: ['3G'], code: 'AWS D1.1', revision: '1', status: 'approved' },
            { id: 'w2', wpsNumber: 'WPS-2', process: 'GTAW', baseMetal: '304 SS', jointDesign: 'Butt', positions: ['1G'], code: 'ASME IX', revision: '2', status: 'draft' },
          ],
        });
      }
      if (action === 'pqr-list') {
        return envelope({
          pqr: [
            { id: 'q1', pqrNumber: 'PQR-1', wpsNumber: 'WPS-9', process: 'SMAW', baseMetal: 'A36', code: 'AWS D1.1', tensileResult: 'pass', bendResult: 'pass' },
            { id: 'q2', pqrNumber: 'PQR-2', wpsNumber: 'WPS-8', process: 'GTAW', baseMetal: '304 SS', code: 'ASME IX', welder: 'Pat', tensileResult: 'pass', bendResult: 'not_recorded' },
          ],
        });
      }
      return envelope({});
    });
  });

  it('searches WPS records by process and PQR records by welder', async () => {
    render(<WeldingOperations />);
    fireEvent.click(screen.getByRole('button', { name: /^WPS/ }));
    await screen.findByText(/WPS-1/);
    fireEvent.change(screen.getByLabelText('Search WPS records'), { target: { value: 'gtaw' } });
    await waitFor(() => expect(screen.queryByText(/WPS-1/)).toBeNull());
    expect(screen.getByText(/WPS-2/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Search PQR records'), { target: { value: 'pat' } });
    await waitFor(() => expect(screen.queryByText(/PQR-1/)).toBeNull());
    expect(screen.getByText(/PQR-2/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Search WPS records'), { target: { value: 'zzz-no-match' } });
    await screen.findByText('No WPS records match your search.');
  });
});

// ── FIX-world-observatory-007 ──────────────────────────────────────────────

describe('FIX-world-observatory-007 — world search + detail filters', () => {
  beforeEach(() => {
    lensRunMock.mockImplementation(async (_d: unknown, action: string) => {
      if (action === 'overview') {
        return envelope({
          ok: true,
          worlds: [
            { worldId: 'alpha-w', name: 'Alpha World', activeUsers: 3, factionCount: 0, realmCount: 0, districtCount: 0, stuckFactionSchedulers: 0, isTestWorld: false },
            { worldId: 'beta-w', name: 'Beta World', activeUsers: 5, factionCount: 2, realmCount: 0, districtCount: 2, stuckFactionSchedulers: 0, isTestWorld: false },
          ],
        });
      }
      if (action === 'world_detail') {
        return envelope({
          ok: true,
          worldId: 'beta-w',
          worldName: 'Beta World',
          population: { activeUsers: 5 },
          factions: {
            count: 2,
            states: [
              { factionId: 'fac-one', stance: 'war', momentum: 3, phase: 'rising' },
              { factionId: 'fac-two', stance: 'truce', momentum: 1, phase: null },
            ],
            relations: [],
          },
          realms: [],
          districts: [
            { id: 'd1', name: 'North District', areaM2: 100, buildingCount: 4, lightingTag: 'gas' },
            { id: 'd2', name: 'South District', areaM2: 200, buildingCount: 9, lightingTag: 'led' },
          ],
          health: { platformWideChecked: 0, factionSchedulerFindings: [] },
        });
      }
      return envelope({ ok: true });
    });
  });

  it('searches worlds, then filters factions and districts in the detail', async () => {
    render(<WorldObservatoryPage />);
    await screen.findByText('Alpha World');
    fireEvent.change(screen.getByLabelText('Search worlds'), { target: { value: 'beta' } });
    await waitFor(() => expect(screen.queryByText('Alpha World')).toBeNull());
    fireEvent.click(screen.getByRole('button', { name: /Drill into Beta World/ }));
    await screen.findByText('fac-one');
    fireEvent.change(screen.getByLabelText('Filter factions'), { target: { value: 'fac-two' } });
    await waitFor(() => expect(screen.queryByText('fac-one')).toBeNull());
    expect(screen.getByText('fac-two')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Districts/ }));
    await screen.findByText('North District');
    fireEvent.change(screen.getByLabelText('Filter districts'), { target: { value: 'south' } });
    await waitFor(() => expect(screen.queryByText('North District')).toBeNull());
    expect(screen.getByText('South District')).toBeTruthy();
  });
});
