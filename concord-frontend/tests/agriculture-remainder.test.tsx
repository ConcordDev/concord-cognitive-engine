/** Agriculture remainder (B3) — F3 feed display join + F5 fleet panel join. */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

const lensRunMock = vi.fn();
vi.mock('@/lib/api/client', () => ({ lensRun: (...a: unknown[]) => lensRunMock(...a) }));

let farmEquipmentArts: unknown[] = [];
vi.mock('@/lib/hooks/use-lens-data', () => ({
  useLensData: (_lens: string, type: string) => ({
    items: type === 'FarmEquipment' ? farmEquipmentArts : [],
    isLoading: false, error: null, refetch: vi.fn(),
  }),
}));
vi.mock('@/hooks/useRealtimeLens', () => ({
  useRealtimeLens: () => ({ latestData: null, alerts: [], insights: [], isLive: false, lastUpdated: null }),
}));
vi.mock('@/components/agriculture/FarmDeskContext', () => ({
  useFarmDesk: () => ({ handleAction: vi.fn() }),
}));

import { OpsDeskPanel } from '@/components/agriculture/OpsDeskPanel';
import { AgricultureFeedPanel } from '@/components/agriculture/AgricultureFeedPanel';

function wrap(ui: React.ReactElement) {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      {ui}
    </QueryClientProvider>,
  );
}

const SHELL_RESULTS: Record<string, unknown> = {
  'field-list': { fields: [] }, 'equipment-list': { equipment: [] },
  'work-orders-list': { orders: [] }, 'grain-bins-list': { bins: [] },
};

beforeEach(() => {
  lensRunMock.mockReset();
  farmEquipmentArts = [];
  lensRunMock.mockImplementation((arg: { action?: string } | string, action?: string) => {
    const name = typeof arg === 'string' ? action : arg?.action;
    return Promise.resolve({ data: { ok: true, result: SHELL_RESULTS[name || ''] ?? {} } });
  });
});

describe('OpsDeskPanel — F5 the fleet panel joins both equipment stores', () => {
  it('an artifact-plane record lists in the fleet panel (was: count 1 over "No equipment.")', async () => {
    farmEquipmentArts = [{
      id: 'art_eq1', title: 'PR2AGRI EQUIP 1104',
      data: { name: 'PR2AGRI EQUIP 1104', equipmentType: 'tractor', make: 'Deere', model: '5075E', status: 'planned', notes: '', condition: '' },
    }];
    wrap(<OpsDeskPanel onOpenRecords={() => {}} />);
    expect(await screen.findByText('PR2AGRI EQUIP 1104')).toBeTruthy();
    expect(screen.queryByText('No equipment.')).toBeNull();
    expect(document.body.textContent).toContain('0/1');
  });

  it('a shell-store record still lists, and a record in both stores lists once', async () => {
    farmEquipmentArts = [{
      id: 'art_eq1', title: 'Shared Tractor',
      data: { name: 'Shared Tractor', equipmentType: 'tractor', make: 'Deere', model: '5075E', status: 'planned', notes: '', condition: '' },
    }];
    lensRunMock.mockImplementation((arg: { action?: string } | string, action?: string) => {
      const name = typeof arg === 'string' ? action : arg?.action;
      const result = name === 'equipment-list'
        ? { equipment: [{ id: 'eq_1', name: 'Shared Tractor', kind: 'tractor', make: 'Deere', model: '5075E', status: 'working' }] }
        : (SHELL_RESULTS[name || ''] ?? {});
      return Promise.resolve({ data: { ok: true, result } });
    });
    wrap(<OpsDeskPanel onOpenRecords={() => {}} />);
    // The artifact row renders synchronously; the shell read settles async —
    // wait for the joined state (shell row wins the dedupe, working = 1).
    await waitFor(() => expect(document.body.textContent).toContain('1/1'));
    expect(screen.getAllByText('Shared Tractor')).toHaveLength(1);
  });
});

describe('AgricultureFeedPanel — F3 the section lists what Pull ingests', () => {
  const ITEM = {
    id: 'dtu_wb_1', title: 'Cereal yield: France (2022)',
    summary: 'Country: France · Year: 2022 · Cereal yield: 6900 kg per hectare',
    sourceName: 'World Bank Open Data', sourceUrl: 'https://data.worldbank.org/indicator/AG.YLD.CREL.KG',
    publishedAt: '2026-11-04T10:00:00.000Z', tags: ['agriculture', 'crop-yield'],
  };

  it('renders the ingested items feed-list returns', async () => {
    lensRunMock.mockImplementation((arg: { action?: string } | string, action?: string) => {
      const name = typeof arg === 'string' ? action : arg?.action;
      return Promise.resolve({ data: { ok: true, result: name === 'feed-list' ? { items: [ITEM], total: 1 } : {} } });
    });
    wrap(<AgricultureFeedPanel />);
    expect(await screen.findByText('Cereal yield: France (2022)')).toBeTruthy();
    expect(screen.queryByText('No live feed items yet')).toBeNull();
  });

  it('an empty ingest reads as the honest empty state', async () => {
    wrap(<AgricultureFeedPanel />);
    expect(await screen.findByText('No live feed items yet')).toBeTruthy();
  });

  it('Pull reports the ingest accounting and the list refreshes with the new item', async () => {
    let pulled = false;
    lensRunMock.mockImplementation((arg: { action?: string } | string, action?: string) => {
      const name = typeof arg === 'string' ? action : arg?.action;
      if (name === 'feed') {
        pulled = true;
        return Promise.resolve({ data: { ok: true, result: { ingested: 1, skipped: 12, source: 'worldbank-crop-yields' } } });
      }
      return Promise.resolve({ data: { ok: true, result: { items: pulled ? [ITEM] : [], total: pulled ? 1 : 0 } } });
    });
    wrap(<AgricultureFeedPanel />);
    expect(await screen.findByText('No live feed items yet')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Pull feed/ }));
    expect(await screen.findByText(/Ingested 1 new DTU from worldbank-crop-yields · 12 already seen/)).toBeTruthy();
    await waitFor(() => expect(screen.getByText('Cereal yield: France (2022)')).toBeTruthy());
  });
});
