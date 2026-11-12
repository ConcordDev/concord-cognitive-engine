/**
 * Audit sweep CB-0490 (missing find controls, third leg), FE pins 1:
 *   mining-009           MineSiteManager site search
 *   pets-007             PetCareSection pet search
 *   move-builder-007     MintedMovesPanel move search
 *   schema-004           SchemaWorkbench registry search + sort
 *   consulting-009       EngagementTracker engagement search
 *   creative-003         CreativeBoardsSection board search + sort
 *   command-center-006   command-center page alert search
 *   concord-link-frontier-007 frontier page link search
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

const lensRun = vi.fn();
vi.mock('@/lib/api/client', () => ({
  lensRun: (...args: unknown[]) => lensRun(...args),
  api: {
    get: vi.fn(() => Promise.resolve({ data: {} })),
    post: vi.fn(() => Promise.resolve({ data: { ok: true } })),
    put: vi.fn(() => Promise.resolve({ data: { ok: true } })),
    patch: vi.fn(() => Promise.resolve({ data: { ok: true } })),
    delete: vi.fn(() => Promise.resolve({ data: { ok: true } })),
  },
  apiHelpers: { lens: { runDomain: vi.fn(() => Promise.resolve({ data: { ok: true, result: {} } })) } },
}));
vi.mock('@/hooks/useLensCommand', () => ({ useLensCommand: () => {} }));
vi.mock('@/hooks/useLensNav', () => ({ useLensNav: () => {} }));
vi.mock('@/components/lens/LensShell', () => ({
  LensShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

import { MineSiteManager } from '@/components/mining/MineSiteManager';
import { PetCareSection } from '@/components/pets/PetCareSection';
import { MintedMovesPanel } from '@/components/move-builder/MintedMovesPanel';
import { SchemaWorkbench } from '@/components/schema/SchemaWorkbench';
import { EngagementTracker } from '@/components/consulting/EngagementTracker';
import { CreativeBoardsSection } from '@/components/creative/CreativeBoardsSection';
import CommandCenterPage from '@/app/lenses/command-center/page';
import FrontierPage from '@/app/lenses/concord-link-frontier/page';

function reply(result: unknown) {
  return Promise.resolve({ data: { ok: true, result, error: null } });
}
function wrap(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}
function route(map: Record<string, unknown>) {
  lensRun.mockImplementation((...args: unknown[]) => {
    const action = args[1] as string;
    return reply(action in map ? map[action] : {});
  });
}

beforeEach(() => { lensRun.mockReset(); });

describe('mining-009 — site search', () => {
  it('filters sites by name/kind/commodity with a no-match state', async () => {
    const sites = [
      { id: 's1', name: 'Alpha Pit', kind: 'surface', commodity: 'gold', status: 'active', productionTonnes: 10, incidents: [], incidentCount: 0 },
      { id: 's2', name: 'Beta Shaft', kind: 'underground', commodity: 'coal', status: 'active', productionTonnes: 20, incidents: [], incidentCount: 0 },
    ];
    route({ 'site-list': { sites }, 'mining-dashboard': { sites: 2, active: 2, totalProduction: 30, incidents: 0, seriousIncidents: 0 } });
    wrap(<MineSiteManager />);
    await screen.findByText('Alpha Pit');
    fireEvent.change(screen.getByLabelText('Search sites'), { target: { value: 'gold' } });
    expect(screen.queryByText('Beta Shaft')).toBeNull();
    fireEvent.change(screen.getByLabelText('Search sites'), { target: { value: 'zzz' } });
    expect(await screen.findByText(/No sites match/)).toBeTruthy();
  });
});

describe('pets-007 — pet search', () => {
  it('filters the pet picker by name/species/breed', async () => {
    const pets = [
      { id: 'p1', name: 'Rex', species: 'dog', breed: 'Labrador' },
      { id: 'p2', name: 'Misty', species: 'cat', breed: 'Siamese' },
    ];
    route({
      'pet-list': { pets },
      'pets-dashboard': { pets: 2, overdueVaccines: 0, openReminders: 0, overdueReminders: 0, monthSpend: 0, activeBookings: 0 },
      'pet-detail': { pet: { id: 'p1', name: 'Rex', species: 'dog', breed: 'Labrador', age: { years: 2, months: 3, totalMonths: 27 }, weightKg: 12 }, latestWeighIn: null, counts: { vaccines: 0, medications: 0, vetVisits: 0, weightLogs: 0 }, overdueVaccines: 0, openReminders: 0 },
    });
    wrap(<PetCareSection />);
    await screen.findByRole('button', { name: 'Rex' });
    fireEvent.change(screen.getByLabelText('Search pets'), { target: { value: 'siamese' } });
    expect(screen.queryByRole('button', { name: 'Rex' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Misty' })).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Search pets'), { target: { value: 'zzz' } });
    expect(await screen.findByText(/No pets match/)).toBeTruthy();
  });
});

describe('move-builder-007 — move search', () => {
  it('filters your moves by name/element/kind', async () => {
    const moves = [
      { id: 'm1', name: 'Ember Slash', element: 'fire', skillKind: 'strike', tier: 2 },
      { id: 'm2', name: 'Tide Guard', element: 'water', skillKind: 'guard', tier: 1 },
    ];
    route({ list: { moves } });
    wrap(<MintedMovesPanel />);
    await screen.findByText('Ember Slash');
    fireEvent.change(screen.getByLabelText('Search your moves'), { target: { value: 'tide' } });
    expect(screen.queryByText('Ember Slash')).toBeNull();
    expect(screen.getByText('Tide Guard')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Search your moves'), { target: { value: 'zzz' } });
    expect(await screen.findByText(/No moves match/)).toBeTruthy();
  });
});

describe('schema-004 — registry search + sort', () => {
  it('filters registry entries and sorts them', async () => {
    const schemas = [
      { id: 'sc1', name: 'Invoice', description: 'Billing doc', fieldCount: 4, versionCount: 2, latestVersion: '1.0.0', updatedAt: '2026-11-01' },
      { id: 'sc2', name: 'Ticket', description: 'Support doc', fieldCount: 2, versionCount: 1, latestVersion: '0.2.0', updatedAt: '2026-10-01' },
    ];
    route({ registryList: { schemas } });
    wrap(<SchemaWorkbench />);
    await screen.findByText('Invoice');
    fireEvent.change(screen.getByLabelText('Search schemas'), { target: { value: 'ticket' } });
    expect(screen.queryByText('Invoice')).toBeNull();
    fireEvent.change(screen.getByLabelText('Search schemas'), { target: { value: '' } });
    fireEvent.change(screen.getByLabelText('Sort schemas'), { target: { value: 'name-za' } });
    await waitFor(() => {
      const names = screen.getAllByText(/^(Invoice|Ticket)$/).map((n) => n.textContent);
      expect(names).toEqual(['Ticket', 'Invoice']);
    });
  });
});

describe('consulting-009 — engagement search', () => {
  it('filters engagements by name/client/status', async () => {
    const engagements = [
      { id: 'e1', name: 'Atlas rollout', client: 'Acme', rate: 100, budgetHours: 10, loggedHours: 2, billed: 200, utilizationPct: 20, status: 'active', timeEntries: [] },
      { id: 'e2', name: 'Beacon audit', client: 'Globex', rate: 120, budgetHours: 8, loggedHours: 1, billed: 120, utilizationPct: 12, status: 'active', timeEntries: [] },
    ];
    route({ 'engagement-list': { engagements }, 'consulting-dashboard': { engagements: 2, active: 2, loggedHours: 3, billed: 320 } });
    wrap(<EngagementTracker />);
    await screen.findByText('Atlas rollout');
    fireEvent.change(screen.getByLabelText('Search engagements'), { target: { value: 'globex' } });
    expect(screen.queryByText('Atlas rollout')).toBeNull();
    expect(screen.getByText('Beacon audit')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Search engagements'), { target: { value: 'zzz' } });
    expect(await screen.findByText(/No engagements match/)).toBeTruthy();
  });
});

describe('creative-003 — board search + sort', () => {
  it('filters boards by title; most-cards sort reorders', async () => {
    const boards = [
      { id: 'b1', title: 'Launch story', cardCount: 3 },
      { id: 'b2', title: 'Brand moods', cardCount: 9 },
    ];
    route({ 'board-list': { boards }, 'board-templates': { templates: [] } });
    wrap(<CreativeBoardsSection />);
    await screen.findByText('Launch story');
    fireEvent.change(screen.getByLabelText('Search boards'), { target: { value: 'brand' } });
    expect(screen.queryByText('Launch story')).toBeNull();
    fireEvent.change(screen.getByLabelText('Search boards'), { target: { value: '' } });
    fireEvent.change(screen.getByLabelText('Sort boards'), { target: { value: 'most-cards' } });
    await waitFor(() => {
      const titles = screen.getAllByText(/^(Launch story|Brand moods)$/).map((n) => n.textContent);
      expect(titles).toEqual(['Brand moods', 'Launch story']);
    });
  });
});

describe('command-center-006 — alert search', () => {
  it('filters the alerts board by title/line', async () => {
    const alerts = [
      { id: 'a1', title: 'Pump pressure rising', status: 'open', line: 'North pump line', ackNote: null },
      { id: 'a2', title: 'Gate check due', status: 'open', line: 'South gate line', ackNote: null },
    ];
    lensRun.mockImplementation((...args: unknown[]) => {
      const action = args[1] as string;
      const input = (args[2] || {}) as { id?: string };
      if (action === 'alert-list') return reply({ alerts });
      if (action === 'alert-front') return reply({ alert: null });
      if (action === 'alert-detail') return reply({ alert: alerts.find((a) => a.id === input.id) || null });
      return reply({});
    });
    wrap(<CommandCenterPage />);
    await screen.findByTestId('cc-row-a1');
    fireEvent.change(screen.getByLabelText('Search alerts'), { target: { value: 'gate' } });
    expect(screen.queryByTestId('cc-row-a1')).toBeNull();
    expect(screen.getByTestId('cc-row-a2')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Search alerts'), { target: { value: 'zzz' } });
    expect(await screen.findByText(/No alerts match/)).toBeTruthy();
  });
});

describe('concord-link-frontier-007 — link search', () => {
  it('filters the links board by name', async () => {
    const links = [
      { id: 'l1', name: 'Harbor relay', bearing: 'north pier', mark: '' },
      { id: 'l2', name: 'Summit relay', bearing: 'south ridge', mark: '' },
    ];
    lensRun.mockImplementation((...args: unknown[]) => {
      const action = args[1] as string;
      const input = (args[2] || {}) as { id?: string };
      if (action === 'link-list') return reply({ links });
      if (action === 'link-detail') return reply({ link: links.find((l) => l.id === input.id) || null });
      return reply({});
    });
    wrap(<FrontierPage />);
    await screen.findByRole('button', { name: 'Harbor relay' });
    fireEvent.change(screen.getByLabelText('Search links'), { target: { value: 'summit' } });
    expect(screen.queryByRole('button', { name: 'Harbor relay' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Summit relay' })).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Search links'), { target: { value: 'zzz' } });
    expect(await screen.findByText(/No links match/)).toBeTruthy();
  });
});
