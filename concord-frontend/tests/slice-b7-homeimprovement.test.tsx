import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';

// Slice B7 — FIX-home-improvement-011: boards, inventory assets,
// maintenance reminders and contractors gain edit forms wired to
// their new *-update verbs.

const lensRun = vi.fn();
vi.mock('@/lib/api/client', () => ({
  lensRun: (...args: unknown[]) => lensRun(...args),
  api: { post: vi.fn(), delete: vi.fn(), get: vi.fn() },
  apiHelpers: { lens: { runDomain: vi.fn() } },
}));

import { IdeaBoards } from '@/components/home-improvement/IdeaBoards';
import { HomeInventory } from '@/components/home-improvement/HomeInventory';
import { MaintenanceReminders } from '@/components/home-improvement/MaintenanceReminders';
import { ContractorDirectory } from '@/components/home-improvement/ContractorDirectory';

function ok(result: unknown) {
  return Promise.resolve({ data: { ok: true, result } });
}
function calls(action: string) {
  return lensRun.mock.calls.filter((c) => c[1] === action);
}

beforeEach(() => { lensRun.mockReset(); });

describe('home-improvement edit paths (FIX-home-improvement-011)', () => {
  it('IdeaBoards: Edit opens a form; Save sends board-update', async () => {
    lensRun.mockImplementation((_d: string, action: string) => {
      if (action === 'board-list') return ok({ boards: [{ id: 'b1', name: 'Kitchen dreams', room: 'kitchen', description: '', ideas: [], ideaCount: 0 }], count: 1 });
      return ok({});
    });
    render(<IdeaBoards />);
    fireEvent.click(await screen.findByRole('button', { name: 'Edit board Kitchen dreams' }));
    fireEvent.change(screen.getByLabelText('Edit board name'), { target: { value: 'Kitchen, final' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(calls('board-update')).toHaveLength(1));
    expect(calls('board-update')[0][2]).toMatchObject({ id: 'b1', name: 'Kitchen, final' });
  });

  it('HomeInventory: Edit opens a form; Save sends inventory-update', async () => {
    lensRun.mockImplementation((_d: string, action: string) => {
      if (action === 'inventory-list') return ok({
        assets: [{ id: 'a1', name: 'Fridge', category: 'appliance', room: 'kitchen', brand: 'Old', model: '', serial: '', purchaseDate: '', purchasePrice: 0, warrantyExpires: '', manualUrl: '', notes: '', warrantyStatus: 'none', daysToExpiry: null, createdAt: '' }],
        count: 1, totalValue: 0, warrantiesActive: 0, warrantiesExpiring: 0, warrantiesExpired: 0,
      });
      return ok({});
    });
    render(<HomeInventory />);
    fireEvent.click(await screen.findByRole('button', { name: 'Edit asset Fridge' }));
    fireEvent.change(screen.getByLabelText('Edit asset brand'), { target: { value: 'NewBrand' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(calls('inventory-update')).toHaveLength(1));
    expect(calls('inventory-update')[0][2]).toMatchObject({ id: 'a1', brand: 'NewBrand' });
  });

  it('MaintenanceReminders: Edit opens a form; Save sends maintenance-update', async () => {
    lensRun.mockImplementation((_d: string, action: string) => {
      if (action === 'maintenance-list') return ok({
        reminders: [{ id: 'm1', task: 'Clean gutters', season: 'fall', intervalDays: 365, dueDate: '2026-11-01', lastDone: '', done: false, overdue: false, daysUntil: 30, createdAt: '' }],
        count: 1, overdueCount: 0, upcomingCount: 1,
      });
      if (action === 'maintenance-seasonal') return ok({ season: 'fall', suggestedTasks: [], allSeasons: ['spring', 'summer', 'fall', 'winter'] });
      return ok({});
    });
    render(<MaintenanceReminders />);
    fireEvent.click(await screen.findByRole('button', { name: 'Edit reminder Clean gutters' }));
    fireEvent.change(screen.getByLabelText('Edit reminder task'), { target: { value: 'Clean gutters + downspouts' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(calls('maintenance-update')).toHaveLength(1));
    expect(calls('maintenance-update')[0][2]).toMatchObject({ id: 'm1', task: 'Clean gutters + downspouts' });
  });

  it('ContractorDirectory: Edit opens a form; Save sends pro-update', async () => {
    lensRun.mockImplementation((_d: string, action: string) => {
      if (action === 'pro-list') return ok({
        pros: [{ id: 'p1', name: 'Pat Plumber', trade: 'plumbing', phone: '555-1', email: '', license: '', notes: '', quotes: [], reviews: [], reviewCount: 0, avgRating: 0, quoteCount: 0, lowestQuote: 0 }],
        count: 1,
      });
      return ok({});
    });
    render(<ContractorDirectory />);
    fireEvent.click(await screen.findByRole('button', { name: 'Edit contractor Pat Plumber' }));
    fireEvent.change(screen.getByLabelText('Edit contractor phone'), { target: { value: '555-2' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(calls('pro-update')).toHaveLength(1));
    expect(calls('pro-update')[0][2]).toMatchObject({ id: 'p1', phone: '555-2' });
  });
});
