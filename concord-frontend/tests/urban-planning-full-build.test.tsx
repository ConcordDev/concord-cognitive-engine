// Urban-planning full-build FE render tests (B6) — amendment 3 of the
// builder standard: changed panels carry render tests in the builder's
// own check set. Real components, backend channels mocked in the exact
// shapes the server macros return:
//   F2 CountyDataPanel — the Owner-occupied cell renders the server's
//      ownerOccupiedPct (the panel previously read a field the server
//      never sends and rendered blank); HUD tiers render as household-
//      size rows ("1 person", "4 people"), never raw il* API keys; the
//      six-county scope is printed.
//   F4 ProjectTracker — an approved project offers the Permit Issued
//      advance; the Edit form opens prefilled and saves through
//      project-update.
//   F8 ProjectTracker — status-history timestamps carry a timezone label.
//   F7 PublicCommentPanel — comment delete is two-step and calls
//      comment-remove; ScenarioStudio cards print the DERIVED FAR.
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const lensRun = vi.fn();
const runDomain = vi.fn();
vi.mock('@/lib/api/client', () => ({
  lensRun: (...args: unknown[]) => lensRun(...args),
  apiHelpers: { lens: { runDomain: (...args: unknown[]) => runDomain(...args) } },
  api: { get: vi.fn(() => Promise.resolve({ data: {} })) },
}));
vi.mock('@/components/dtu/SaveAsDtuButton', () => ({ SaveAsDtuButton: () => null }));
vi.mock('@/components/viz', () => ({
  ChartKit: () => React.createElement('div', { 'data-testid': 'chart' }),
}));

import { CountyDataPanel } from '@/components/urban-planning/CountyDataPanel';
import { ProjectTracker } from '@/components/urban-planning/ProjectTracker';
import { PublicCommentPanel } from '@/components/urban-planning/PublicCommentPanel';
import { ScenarioStudio } from '@/components/urban-planning/ScenarioStudio';

function reply(result: Record<string, unknown>, ok = true) {
  return Promise.resolve({ data: { ok, result } });
}

beforeEach(() => {
  lensRun.mockReset();
  runDomain.mockReset();
});

describe('F2 — CountyDataPanel renders the server’s real fields', () => {
  it('owner-occupied renders; HUD rows are household labels, not API keys', async () => {
    runDomain.mockImplementation((_d: string, action: string) => {
      if (action === 'census-acs-county') {
        return reply({
          stateFips: '36', countyFips: '061', year: 2023, countyName: 'New York County, New York',
          totalPopulation: 1600000, medianHouseholdIncome: 90000, medianAge: 38.2,
          bachelorsPlusPct: 64, ownerOccupiedPct: 60, longCommutePct: 27.5, source: 'census-acs',
        });
      }
      return reply({
        areaName: 'New York Metro', medianIncome: 100000, year: 2025,
        veryLowIncome50Pct: [
          { householdSize: 1, limit: 30000 },
          { householdSize: 4, limit: 42000 },
        ],
        extremelyLowIncome30Pct: [{ householdSize: 1, limit: 18000 }],
        lowIncome80Pct: [{ householdSize: 8, limit: 90000 }],
      });
    });
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <CountyDataPanel />
      </QueryClientProvider>,
    );
    expect(screen.getByText(/Six preset metro counties/)).toBeInTheDocument();
    fireEvent.click(screen.getByText(/Pull county data/));
    await waitFor(() => expect(screen.getByText('60%')).toBeInTheDocument());
    expect(screen.getByText('64%')).toBeInTheDocument();
    expect(screen.getByText('27.5%')).toBeInTheDocument();
    expect(screen.getByText(/1 person \$30,000/)).toBeInTheDocument();
    expect(screen.getByText(/4 people \$42,000/)).toBeInTheDocument();
    expect(screen.getByText(/8 people \$90,000/)).toBeInTheDocument();
    expect(screen.queryByText(/il50/)).toBeNull();
  });
});

const PROJECT = {
  id: 'proj-1',
  name: 'Permit Path Tower',
  description: 'fixture',
  parcelId: null,
  parcelApn: null,
  parcelAddress: null,
  projectType: 'mixed_use',
  budget: 100,
  permitNumber: '',
  targetCompletionDate: '',
  status: 'approved',
  statusHistory: [
    { status: 'proposed', at: '2026-11-01T15:04:05.000Z', note: null },
    { status: 'approved', at: '2026-11-02T15:04:05.000Z', note: null },
  ],
  createdAt: '2026-11-01T15:04:05.000Z',
  updatedAt: '2026-11-02T15:04:05.000Z',
};

function mockProjectBackend() {
  lensRun.mockImplementation((_d: string, action: string, input?: Record<string, unknown>) => {
    if (action === 'project-list') return reply({ projects: [PROJECT], count: 1, byStatus: { approved: 1 }, totalBudget: 100 });
    if (action === 'parcel-list') return reply({ parcels: [] });
    if (action === 'project-update') return reply({ project: { ...PROJECT, budget: (input?.budget as number) ?? 100 } });
    if (action === 'project-status-update') return reply({ project: { ...PROJECT, status: input?.status } });
    return reply({});
  });
}

describe('F4/F8 — ProjectTracker permit stage, edit path, labelled history', () => {
  it('an approved project offers Permit Issued as its advance', async () => {
    mockProjectBackend();
    render(<ProjectTracker />);
    await waitFor(() => expect(screen.getByText('Permit Path Tower')).toBeInTheDocument());
    expect(screen.getByRole('button', { name: /Permit Issued/ })).toBeInTheDocument();
  });

  it('status history timestamps carry a timezone label', async () => {
    mockProjectBackend();
    render(<ProjectTracker />);
    await waitFor(() => expect(screen.getByText('Permit Path Tower')).toBeInTheDocument());
    fireEvent.click(screen.getByText(/Show status history/));
    await waitFor(() => expect(screen.getByText(/Nov 1, 2026/)).toBeInTheDocument());
    // A zone abbreviation (UTC/EST/EDT/GMT…) must ride the timestamp —
    // the pre-fix render printed bare local-to-UTC wall time.
    expect(screen.getByText(/Nov 1, 2026.*(UTC|GMT|EST|EDT|CST|CDT|MST|MDT|PST|PDT|AKST|HST)/)).toBeInTheDocument();
  });

  it('the Edit form opens prefilled and saves through project-update', async () => {
    mockProjectBackend();
    render(<ProjectTracker />);
    await waitFor(() => expect(screen.getByText('Permit Path Tower')).toBeInTheDocument());
    fireEvent.click(screen.getByLabelText('Edit project Permit Path Tower'));
    const budgetInput = await screen.findByLabelText('Edit project budget');
    fireEvent.change(budgetInput, { target: { value: '250' } });
    fireEvent.click(screen.getByText('Save changes'));
    await waitFor(() => {
      const call = lensRun.mock.calls.find((c) => c[1] === 'project-update');
      expect(call).toBeTruthy();
      expect((call?.[2] as Record<string, unknown>).budget).toBe(250);
    });
  });
});

describe('F7 — comment delete + derived FAR', () => {
  it('comment delete is two-step and calls comment-remove', async () => {
    let removed = false;
    lensRun.mockImplementation((_d: string, action: string) => {
      if (action === 'scenario-list') return reply({ scenarios: [{ id: 'scn-1', name: 'Host Scenario' }] });
      if (action === 'comment-list') {
        return removed
          ? reply({ comments: [], total: 0, tally: {} })
          : reply({
              comments: [{ id: 'cmt-1', subjectId: 'scn-1', author: 'Fixture Author', stance: 'support', body: 'driver comment', status: 'open', createdAt: '2026-11-01T00:00:00.000Z' }],
              total: 1, tally: { support: 1 },
            });
      }
      if (action === 'comment-remove') { removed = true; return reply({ removed: 1 }); }
      return reply({});
    });
    render(<PublicCommentPanel />);
    await waitFor(() => expect(screen.getByText('driver comment')).toBeInTheDocument());
    fireEvent.click(screen.getByLabelText('Delete comment'));
    fireEvent.click(await screen.findByText('Confirm delete'));
    await waitFor(() => {
      expect(lensRun.mock.calls.some((c) => c[1] === 'comment-remove')).toBe(true);
      expect(screen.getByText(/No comments yet/)).toBeInTheDocument();
    });
  });

  it('scenario cards print the derived FAR (3.2), not the nominal zone FAR (3)', async () => {
    lensRun.mockImplementation((_d: string, action: string) => {
      if (action === 'scenario-list') {
        return reply({
          scenarios: [{
            id: 'scn-a', name: 'Scenario A', description: '', zoneType: 'mixed', lotSizeSqFt: 10000,
            useMix: 'mixed', efficiency: 0.85,
            impacts: {
              zoneType: 'mixed', lotSizeSqFt: 10000, floorAreaRatio: 3, derivedFar: 3.2, lotCoveragePct: 80,
              footprintSqFt: 8000, floors: 4, buildingHeightFt: 44, maxHeightFt: 85, setbackFt: 5,
              grossFloorAreaSqFt: 32000, netFloorAreaSqFt: 27200, dwellingUnits: 20, jobs: 10,
              population: 48, emissionsTonnesPerYear: 100, envelope: { widthFt: 89, depthFt: 89, heightFt: 44 },
            },
          }],
        });
      }
      return reply({});
    });
    render(<ScenarioStudio />);
    await waitFor(() => expect(screen.getByText(/FAR 3\.2/)).toBeInTheDocument());
    expect(screen.queryByText(/FAR 3(?![.\d])/)).toBeNull();
  });
});
