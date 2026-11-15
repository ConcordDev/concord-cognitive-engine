/**
 * find-controls.test.tsx — CB-0466 (audit sweep, missing find controls).
 *
 *  - FIX-agriculture-007: RecordsPanel gains a sort control over the
 *    client-held records (every Records tab shares the panel).
 *  - FIX-analytics-009: saved dashboards gain a sort control; the live
 *    event stream gains a newest/oldest order toggle.
 *  - FIX-app-maker-005: the apps list gains a sort control.
 *  - FIX-artistry-004: ProjectStudio gains project search (title /
 *    description / discipline / tool / tag) + a discipline filter.
 *  - FIX-travel-007: the trips workspace gains search over own + shared
 *    trips (name / destination) with an honest no-match state.
 *  - FIX-veterinary-006: the patient list gains search over the fields
 *    its rows show (name / breed / species / owner).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import React from 'react';

const lensRun = vi.fn();
const appsList = vi.fn();

vi.mock('@/lib/api/client', () => ({
  lensRun: (...args: unknown[]) => lensRun(...args),
  apiHelpers: {
    apps: {
      list: (...a: unknown[]) => appsList(...a),
      create: async () => ({ data: {} }),
      promote: async () => ({ data: {} }),
      validate: async () => ({ data: {} }),
    },
  },
}));
vi.mock('@/store/ui', () => ({
  useUIStore: Object.assign(() => {}, { getState: () => ({ addToast: () => {} }) }),
}));
vi.mock('@/hooks/useRealtimeLens', () => ({
  useRealtimeLens: () => ({ latestData: null, alerts: [], insights: [], isLive: false, lastUpdated: null }),
}));
vi.mock('@/hooks/useLensCommand', () => ({ useLensCommand: () => {} }));
vi.mock('@/components/lens/RealtimeDataPanel', () => ({ RealtimeDataPanel: () => null }));
vi.mock('framer-motion', () => ({
  motion: new Proxy({}, { get: () => (props: Record<string, unknown>) => React.createElement('div', props, props.children as React.ReactNode) }),
}));
vi.mock('@/components/travel/TripWorkspace', () => ({ TripWorkspace: () => null }));

const agItems = vi.fn();
vi.mock('@/lib/hooks/use-lens-data', () => ({
  useLensData: () => ({ items: agItems(), loading: false, error: null, refetch: () => {}, remove: async () => {}, create: async () => {}, update: async () => {} }),
}));
vi.mock('@/lib/hooks/useDensity', () => ({
  useDensity: () => ({ density: 'comfortable', tokens: { gapPx: 12 }, setDensity: () => {} }),
}));
vi.mock('@/components/agriculture/FarmDeskContext', () => ({
  useFarmDesk: () => ({ handleAction: async () => {} }),
}));
vi.mock('@/components/ui/DensityToggle', () => ({ DensityToggle: () => null }));

import { RecordsPanel } from '@/components/agriculture/RecordsPanel';
import { AdvancedAnalytics } from '@/components/analytics/AdvancedAnalytics';
import { AppsPanel } from '@/components/app-maker/AppsPanel';
import { ProjectStudio } from '@/components/artistry/ProjectStudio';
import { TripWorkspaceSection } from '@/components/travel/TripWorkspaceSection';
import { PatientsPanel } from '@/components/veterinary/PatientsPanel';

function envelope(result: unknown) {
  return { data: { ok: true, result, error: null } };
}

beforeEach(() => {
  lensRun.mockReset();
  appsList.mockReset();
  agItems.mockReset();
  lensRun.mockImplementation(async () => envelope({}));
});

afterEach(() => cleanup());

// ── FIX-agriculture-007 ────────────────────────────────────────────────────

describe('FIX-agriculture-007 — RecordsPanel sort', () => {
  it('sorts the records by name and by age from the sort control', async () => {
    agItems.mockReturnValue([
      { id: 'r1', title: 'Zulu field', createdAt: '2026-01-02T00:00:00Z', updatedAt: '2026-01-02T00:00:00Z', data: { status: 'planned', description: '' } },
      { id: 'r2', title: 'Alpha field', createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z', data: { status: 'planted', description: '' } },
    ]);
    const { container } = render(<RecordsPanel kind="fields" />);
    await screen.findByText('Zulu field');
    // Default: newest first.
    expect(container.textContent!.indexOf('Zulu field')).toBeLessThan(container.textContent!.indexOf('Alpha field'));
    fireEvent.change(screen.getByLabelText('Sort fields'), { target: { value: 'name-asc' } });
    await waitFor(() => {
      expect(container.textContent!.indexOf('Alpha field')).toBeLessThan(container.textContent!.indexOf('Zulu field'));
    });
    fireEvent.change(screen.getByLabelText('Sort fields'), { target: { value: 'oldest' } });
    await waitFor(() => {
      expect(container.textContent!.indexOf('Alpha field')).toBeLessThan(container.textContent!.indexOf('Zulu field'));
    });
  });
});

// ── FIX-analytics-009 ──────────────────────────────────────────────────────

describe('FIX-analytics-009 — dashboard sort + stream order', () => {
  beforeEach(() => {
    lensRun.mockImplementation(async (_d: unknown, action: string) => {
      if (action === 'event-stats') return envelope({ topEvents: [] });
      if (action === 'dashboard-list') {
        return envelope({
          dashboards: [
            { id: 'd1', name: 'Beta dash', widgetCount: 1, updatedAt: '2026-02-01T00:00:00Z' },
            { id: 'd2', name: 'Alpha dash', widgetCount: 5, updatedAt: '2026-01-01T00:00:00Z' },
          ],
        });
      }
      if (action === 'event-stream') {
        return envelope({
          events: [
            { id: 'e1', name: 'newer-event', distinctId: 'u1', properties: {}, at: '2026-03-02T10:00:00Z' },
            { id: 'e2', name: 'older-event', distinctId: 'u1', properties: {}, at: '2026-03-01T10:00:00Z' },
          ],
          matched: 2, cursor: 'c1',
        });
      }
      return envelope({});
    });
  });

  it('sorts saved dashboards by name and widget count', async () => {
    const { container } = render(<AdvancedAnalytics />);
    await screen.findByText('Beta dash');
    // Default: recently updated first.
    expect(container.textContent!.indexOf('Beta dash')).toBeLessThan(container.textContent!.indexOf('Alpha dash'));
    fireEvent.change(screen.getByLabelText('Sort saved dashboards'), { target: { value: 'name-asc' } });
    await waitFor(() => {
      expect(container.textContent!.indexOf('Alpha dash')).toBeLessThan(container.textContent!.indexOf('Beta dash'));
    });
    fireEvent.change(screen.getByLabelText('Sort saved dashboards'), { target: { value: 'widgets' } });
    await waitFor(() => {
      expect(container.textContent!.indexOf('Alpha dash')).toBeLessThan(container.textContent!.indexOf('Beta dash'));
    });
  });

  it('reorders the live event stream oldest-first on request', async () => {
    const { container } = render(<AdvancedAnalytics />);
    fireEvent.click(screen.getByRole('button', { name: /Live stream/ }));
    await screen.findByText('newer-event');
    expect(container.textContent!.indexOf('newer-event')).toBeLessThan(container.textContent!.indexOf('older-event'));
    fireEvent.change(screen.getByLabelText('Event order'), { target: { value: 'oldest' } });
    await waitFor(() => {
      expect(container.textContent!.indexOf('older-event')).toBeLessThan(container.textContent!.indexOf('newer-event'));
    });
  });
});

// ── FIX-app-maker-005 ──────────────────────────────────────────────────────

describe('FIX-app-maker-005 — apps sort', () => {
  it('sorts the apps list by name from the sort control', async () => {
    appsList.mockResolvedValue({
      data: {
        apps: [
          { id: 'app_z', name: 'Zeta App', status: 'draft', author: 'u1', version: '0.0.1', createdAt: '2026-06-28' },
          { id: 'app_a', name: 'Alpha App', status: 'published', author: 'u1', version: '1.0.0', createdAt: '2026-06-27' },
        ],
      },
    });
    const { container } = render(<AppsPanel />);
    await screen.findByText('Zeta App');
    // Default: newest first.
    expect(container.textContent!.indexOf('Zeta App')).toBeLessThan(container.textContent!.indexOf('Alpha App'));
    fireEvent.change(screen.getByLabelText('Sort apps'), { target: { value: 'name-asc' } });
    await waitFor(() => {
      expect(container.textContent!.indexOf('Alpha App')).toBeLessThan(container.textContent!.indexOf('Zeta App'));
    });
  });
});

// ── FIX-artistry-004 ───────────────────────────────────────────────────────

describe('FIX-artistry-004 — project search + discipline filter', () => {
  beforeEach(() => {
    lensRun.mockImplementation(async (_d: unknown, action: string) => {
      if (action === 'projectList') {
        return envelope({
          projects: [
            { id: 'p1', title: 'Ink Study', description: 'pen work', discipline: 'drawing', tools: ['fineliner'], tags: ['ink'], images: [], processSteps: [], coverUrl: '', published: true, views: 3, createdAt: '2026-01-01' },
            { id: 'p2', title: 'Clay Vessels', description: 'stoneware', discipline: 'ceramics', tools: ['wheel'], tags: ['clay'], images: [], processSteps: [], coverUrl: '', published: true, views: 5, createdAt: '2026-01-02' },
          ],
        });
      }
      return envelope({});
    });
  });

  it('finds projects by tag and narrows by discipline; no-match is honest', async () => {
    render(<ProjectStudio />);
    await screen.findByText('Ink Study');
    fireEvent.change(screen.getByLabelText('Search projects'), { target: { value: 'ink' } });
    await waitFor(() => expect(screen.queryByText('Clay Vessels')).toBeNull());
    expect(screen.getByText('Ink Study')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Search projects'), { target: { value: '' } });
    await screen.findByText('Clay Vessels');
    fireEvent.change(screen.getByLabelText('Filter projects by discipline'), { target: { value: 'ceramics' } });
    await waitFor(() => expect(screen.queryByText('Ink Study')).toBeNull());
    fireEvent.change(screen.getByLabelText('Search projects'), { target: { value: 'zzz-no-match' } });
    await screen.findByText('No projects match your search.');
  });
});

// ── FIX-travel-007 ─────────────────────────────────────────────────────────

describe('FIX-travel-007 — trip search', () => {
  beforeEach(() => {
    lensRun.mockImplementation(async (_d: unknown, action: string) => {
      if (action === 'trip-list') {
        return envelope({
          trips: [
            { id: 't1', name: 'Alps Trek', destination: 'Chamonix', status: 'upcoming', startDate: '2026-05-01', endDate: '2026-05-07' },
            { id: 't2', name: 'Beach Week', destination: 'Lisbon', status: 'draft', startDate: '', endDate: '' },
          ],
        });
      }
      if (action === 'trip-shared-list') return envelope({ trips: [] });
      return envelope({});
    });
  });

  it('searches trips by destination and reports no-match honestly', async () => {
    render(<TripWorkspaceSection />);
    await screen.findByText('Alps Trek');
    fireEvent.change(screen.getByLabelText('Search trips'), { target: { value: 'lisbon' } });
    await waitFor(() => expect(screen.queryByText('Alps Trek')).toBeNull());
    expect(screen.getByText('Beach Week')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Search trips'), { target: { value: 'zzz-no-match' } });
    await screen.findByText('No trips match your search.');
  });
});

// ── FIX-veterinary-006 ─────────────────────────────────────────────────────

describe('FIX-veterinary-006 — patient search', () => {
  beforeEach(() => {
    lensRun.mockImplementation(async (_d: unknown, action: string) => {
      if (action === 'patient-list') {
        return envelope({
          patients: [
            { id: 'v1', name: 'Rex', species: 'dog', breed: 'Collie', owner: 'Sam', ageYears: 4, weightLbs: 40, notes: '', visits: [], vaccinations: [], createdAt: '2026-01-01' },
            { id: 'v2', name: 'Misty', species: 'cat', breed: 'Siamese', owner: 'Jo', ageYears: 2, weightLbs: 9, notes: '', visits: [], vaccinations: [], createdAt: '2026-01-02' },
          ],
        });
      }
      return envelope({});
    });
  });

  it('searches patients by owner and reports no-match honestly', async () => {
    render(<PatientsPanel />);
    await screen.findByText('Rex');
    fireEvent.change(screen.getByLabelText('Search patients'), { target: { value: 'jo' } });
    await waitFor(() => expect(screen.queryByText('Rex')).toBeNull());
    expect(screen.getByText('Misty')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Search patients'), { target: { value: 'zzz-no-match' } });
    await screen.findByText('No patients match your search.');
  });
});
